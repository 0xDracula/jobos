package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jobbos/api/internal/realtime"
	"jobbos/api/internal/store"
)

var visibilitySignals = []string{"online_last_seen", "listening_status", "listening_history", "read_receipts", "typing"}

func (a *api) visibility(ctx context.Context) map[string]string {
	out := map[string]string{}
	if raw, err := a.Store.AppSetting(ctx, "visibility"); err == nil && raw != nil {
		_ = json.Unmarshal(raw, &out)
	}
	return out
}

func canSee(modes map[string]string, viewer, subject *store.User, signal string) bool {
	if viewer.ID == subject.ID {
		return true
	}
	switch modes[signal] {
	case "shared":
		return true
	case "admin":
		return viewer.Role == "admin"
	default:
		return false
	}
}

type memberCache struct {
	mu    sync.Mutex
	users []store.User
	at    time.Time
}

func (a *api) memberList(ctx context.Context) []store.User {
	a.team.mu.Lock()
	defer a.team.mu.Unlock()
	if time.Since(a.team.at) < time.Minute && a.team.users != nil {
		return a.team.users
	}
	users, err := a.Store.Members(ctx)
	if err != nil {
		return a.team.users
	}
	a.team.users = users
	a.team.at = time.Now()
	return users
}

func (a *api) member(ctx context.Context, id uuid.UUID) *store.User {
	for _, u := range a.memberList(ctx) {
		if u.ID == id {
			u := u
			return &u
		}
	}
	return nil
}

func (a *api) others(ctx context.Context, id uuid.UUID) []store.User {
	var out []store.User
	for _, u := range a.memberList(ctx) {
		if u.ID != id {
			out = append(out, u)
		}
	}
	return out
}

func (a *api) broadcast(ctx context.Context, e realtime.Event) {
	if a.Hub == nil {
		return
	}
	for _, u := range a.memberList(ctx) {
		a.Hub.Send(u.ID, e)
	}
}

func (a *api) registerRealtime() {
	if a.Hub == nil {
		return
	}
	a.Hub.OnPresence = func(c realtime.PresenceChange) {
		ctx := context.Background()
		if !c.LastSeen.IsZero() {
			_ = a.Store.TouchLastSeen(ctx, c.User, c.LastSeen)
		}
		subject := a.member(ctx, c.User)
		if subject == nil {
			return
		}
		modes := a.visibility(ctx)
		for _, viewer := range a.others(ctx, c.User) {
			viewer := viewer
			if canSee(modes, &viewer, subject, "online_last_seen") {
				a.Hub.Send(viewer.ID, realtime.NewEvent("presence.update", map[string]any{"user": c.User, "online": c.Online, "last_seen": c.LastSeen}))
			}
		}
	}
	a.Hub.Handle("chat.typing", func(ctx context.Context, user uuid.UUID, e realtime.Event, _ func(realtime.Event)) {
		subject := a.member(ctx, user)
		if subject == nil {
			return
		}
		modes := a.visibility(ctx)
		for _, viewer := range a.others(ctx, user) {
			viewer := viewer
			if canSee(modes, &viewer, subject, "typing") {
				a.Hub.Send(viewer.ID, realtime.NewEvent("chat.typing", map[string]any{"user": user}))
			}
		}
	})
	a.Hub.Handle("clock.ping", func(_ context.Context, _ uuid.UUID, e realtime.Event, reply func(realtime.Event)) {
		var d struct {
			T0 float64 `json:"t0"`
		}
		_ = json.Unmarshal(e.Data, &d)
		reply(realtime.NewEvent("clock.pong", map[string]any{"t0": d.T0, "server_ts": time.Now().UnixMilli()}))
	})
	a.registerTogether()
}

func (a *api) websocket(w http.ResponseWriter, r *http.Request) {
	if a.Hub == nil {
		writeError(w, http.StatusServiceUnavailable, "realtime is off")
		return
	}
	a.Hub.ServeWS(w, r, uid(r))
}

func (a *api) presence(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	me := currentUser(r)
	modes := a.visibility(ctx)
	lastSeen, err := a.Store.LastSeen(ctx)
	if err != nil {
		a.serverError(w, "last seen", err)
		return
	}
	type person struct {
		ID          uuid.UUID       `json:"id"`
		DisplayName string          `json:"display_name"`
		Online      *bool           `json:"online"`
		LastSeen    *time.Time      `json:"last_seen"`
		Quiet       bool            `json:"quiet"`
		Listening   *bool           `json:"listening"`
		Playing     *nowPlayingView `json:"playing,omitempty"`
	}
	now, err := a.Store.ListeningNow(ctx)
	if err != nil {
		a.serverError(w, "listening", err)
		return
	}
	var people []person
	for _, u := range a.memberList(ctx) {
		u := u
		p := person{ID: u.ID, DisplayName: u.DisplayName}
		if canSee(modes, me, &u, "online_last_seen") {
			on := a.Hub != nil && a.Hub.Online(u.ID)
			p.Online = &on
			p.LastSeen = lastSeen[u.ID]
		}
		if canSee(modes, me, &u, "listening_status") {
			n, playing := now[u.ID]
			playing = playing && a.Hub != nil && a.Hub.Online(u.ID)
			p.Listening = &playing
			if playing {
				if t, err := a.Store.Track(ctx, n.TrackID); err == nil {
					p.Playing = &nowPlayingView{TrackID: t.ID, Title: t.Title, Artists: t.Artists, ArtworkThumbURL: t.ArtworkThumbURL,
						PositionMs: n.PositionMs, Device: n.DeviceName, At: n.UpdatedAt}
				}
			}
		}
		p.Quiet = a.quiet(ctx, u.ID)
		people = append(people, p)
	}
	lamps, err := a.Store.Lamps(ctx)
	if err != nil {
		a.serverError(w, "lamps", err)
		return
	}
	unread, err := a.Store.UnreadCount(ctx, me.ID)
	if err != nil {
		a.serverError(w, "unread", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"people": people, "lamps": lamps, "unread": unread})
}

type nowPlayingView struct {
	TrackID         uuid.UUID `json:"track_id"`
	Title           string    `json:"title"`
	Artists         []string  `json:"artists"`
	ArtworkThumbURL *string   `json:"artwork_thumb_url"`
	PositionMs      int32     `json:"position_ms"`
	Device          string    `json:"device"`
	At              time.Time `json:"at"`
}

func (a *api) quiet(ctx context.Context, userID uuid.UUID) bool {
	raw, err := a.Store.UserSetting(ctx, userID, "quiet_mode")
	return err == nil && strings.TrimSpace(string(raw)) == "true"
}

func (a *api) setQuiet(w http.ResponseWriter, r *http.Request) {
	var in struct {
		On bool `json:"on"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	val, _ := json.Marshal(in.On)
	if err := a.Store.SetSetting(r.Context(), uid(r), "quiet_mode", val); err != nil {
		a.serverError(w, "quiet mode", err)
		return
	}
	a.broadcast(r.Context(), realtime.NewEvent("quiet.update", map[string]any{"user": uid(r), "on": in.On}))
	writeJSON(w, http.StatusOK, map[string]any{"on": in.On})
}

func (a *api) adminVisibility(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"visibility": a.visibility(r.Context()), "signals": visibilitySignals})
}

func (a *api) setVisibility(w http.ResponseWriter, r *http.Request) {
	var in map[string]string
	if !readJSON(w, r, &in) {
		return
	}
	out := map[string]string{}
	for _, s := range visibilitySignals {
		m := in[s]
		ok := m == "shared" || m == "off" || (m == "admin" && s != "typing")
		if m != "" && !ok {
			writeError(w, http.StatusBadRequest, "invalid mode for "+s)
			return
		}
		if m != "" {
			out[s] = m
		}
	}
	raw, _ := json.Marshal(out)
	if err := a.Store.SetAppSetting(r.Context(), "visibility", raw); err != nil {
		a.serverError(w, "save visibility", err)
		return
	}
	me := uid(r)
	a.Store.Audit(r.Context(), &me, "visibility.set", "", out)
	a.broadcast(r.Context(), realtime.NewEvent("visibility.update", nil))
	writeJSON(w, http.StatusOK, map[string]any{"visibility": out})
}

const maxChatBody = 4000

func (a *api) chatMessages(w http.ResponseWriter, r *http.Request) {
	parse := func(name string) (*uuid.UUID, bool) {
		v := r.URL.Query().Get(name)
		if v == "" {
			return nil, true
		}
		id, err := uuid.Parse(v)
		if err != nil {
			writeError(w, http.StatusBadRequest, name+" must be a message ID")
			return nil, false
		}
		return &id, true
	}
	around, ok := parse("around")
	if !ok {
		return
	}
	if around != nil {
		msgs, err := a.Store.ChatAround(r.Context(), *around, intParam(r, "limit", 50, 200))
		if err != nil {
			a.serverError(w, "chat around", err)
			return
		}
		reads, err := a.visibleReads(r.Context(), currentUser(r))
		if err != nil {
			a.serverError(w, "chat reads", err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"messages": msgs, "reads": reads})
		return
	}
	before, ok := parse("before")
	if !ok {
		return
	}
	after, ok := parse("after")
	if !ok {
		return
	}
	msgs, err := a.Store.ChatPage(r.Context(), before, after, intParam(r, "limit", 50, 200))
	if err != nil {
		a.serverError(w, "chat page", err)
		return
	}
	reads, err := a.visibleReads(r.Context(), currentUser(r))
	if err != nil {
		a.serverError(w, "chat reads", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": msgs, "reads": reads})
}

func (a *api) visibleReads(ctx context.Context, viewer *store.User) ([]store.ChatRead, error) {
	reads, err := a.Store.ChatReads(ctx)
	if err != nil {
		return nil, err
	}
	modes := a.visibility(ctx)
	out := []store.ChatRead{}
	for _, rd := range reads {
		if subject := a.member(ctx, rd.UserID); subject != nil && canSee(modes, viewer, subject, "read_receipts") {
			out = append(out, rd)
		}
	}
	return out, nil
}

func (a *api) cardData(ctx context.Context, kind string, raw json.RawMessage) (json.RawMessage, string) {
	var d struct {
		TrackID uuid.UUID `json:"track_id"`
		StartMs *int      `json:"start_ms,omitempty"`
		Note    string    `json:"note,omitempty"`
		Mood    string    `json:"mood,omitempty"`
		Lines   []struct {
			Text string `json:"text"`
			Ms   *int   `json:"ms"`
		} `json:"lines,omitempty"`
	}
	if json.Unmarshal(raw, &d) != nil || d.TrackID == uuid.Nil {
		return nil, "a card needs track_id"
	}
	if kind == "lyric" && (len(d.Lines) == 0 || len(d.Lines) > 12) {
		return nil, "a lyric card needs 1 to 12 lines"
	}
	if utf8.RuneCountInString(d.Note) > 500 {
		return nil, "the note is too long"
	}
	t, err := a.Store.Track(ctx, d.TrackID)
	if err != nil {
		return nil, "track not found"
	}
	out := map[string]any{"track_id": d.TrackID, "track": map[string]any{
		"id": t.ID, "title": t.Title, "artists": t.Artists, "artwork_url": t.ArtworkURL, "artwork_thumb_url": t.ArtworkThumbURL, "duration_ms": t.DurationMs,
	}}
	if d.StartMs != nil && *d.StartMs >= 0 {
		out["start_ms"] = *d.StartMs
	}
	if d.Note != "" {
		out["note"] = d.Note
	}
	if kind == "song" && moodKeys[d.Mood] {
		out["mood"] = d.Mood
	}
	if kind == "lyric" {
		out["lines"] = d.Lines
	}
	b, _ := json.Marshal(out)
	return b, ""
}

func (a *api) sendChat(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ClientKey string          `json:"client_key"`
		Kind      string          `json:"kind"`
		Body      string          `json:"body"`
		Data      json.RawMessage `json:"data"`
		ReplyTo   *uuid.UUID      `json:"reply_to"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.Kind == "" {
		in.Kind = "text"
	}
	in.Body = strings.TrimSpace(in.Body)
	if in.ClientKey == "" || len(in.ClientKey) > 64 {
		writeError(w, http.StatusBadRequest, "client_key is required")
		return
	}
	switch in.Kind {
	case "text":
		if in.Body == "" || utf8.RuneCountInString(in.Body) > maxChatBody {
			writeError(w, http.StatusBadRequest, "a message needs 1 to 4000 characters")
			return
		}
		in.Data = nil
	case "song", "lyric":
		data, problem := a.cardData(r.Context(), in.Kind, in.Data)
		if problem != "" {
			writeError(w, http.StatusBadRequest, problem)
			return
		}
		in.Data = data
	case "voice", "photo", "sticker":
		if utf8.RuneCountInString(in.Body) > 1000 || (in.Kind != "photo" && in.Body != "") {
			writeError(w, http.StatusBadRequest, "only a photo takes a caption, of 1000 characters at most")
			return
		}
		data, problem := a.mediaData(r.Context(), uid(r), in.Kind, in.Data)
		if problem != "" {
			writeError(w, http.StatusBadRequest, problem)
			return
		}
		in.Data = data
	default:
		writeError(w, http.StatusBadRequest, "kind must be text, song, lyric, voice, photo or sticker")
		return
	}
	a.postChat(w, r, store.ChatInput{ClientKey: in.ClientKey, Kind: in.Kind, Body: in.Body, Data: in.Data, ReplyTo: in.ReplyTo})
}

func (a *api) postChat(w http.ResponseWriter, r *http.Request, in store.ChatInput) {
	m, created, err := a.Store.SendChat(r.Context(), uid(r), in)
	if err != nil {
		a.serverError(w, "send chat", err)
		return
	}
	if created {
		a.broadcast(r.Context(), realtime.NewEvent("chat.message", m))
		me := currentUser(r)
		for _, u := range a.others(r.Context(), me.ID) {
			if a.Hub == nil || !a.Hub.Online(u.ID) {
				a.notify(u.ID, "messages", me.DisplayName, chatPreview(m), "/chat/")
			}
		}
	}
	writeJSON(w, http.StatusOK, m)
}

func chatPreview(m *store.ChatMessage) string {
	switch m.Kind {
	case "song":
		return "Sent a song"
	case "lyric":
		return "Sent lyrics"
	case "voice":
		return "Voice note"
	case "photo":
		if m.Body == "" {
			return "Photo"
		}
		return "Photo: " + truncateRunes(m.Body, 100)
	case "sticker":
		return "Sticker"
	case "swap":
		return "Song swap: " + truncateRunes(m.Body, 100)
	}
	if utf8.RuneCountInString(m.Body) > 120 {
		return string([]rune(m.Body)[:120]) + "…"
	}
	return m.Body
}

func (a *api) editChat(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	var in struct {
		Body string `json:"body"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	in.Body = strings.TrimSpace(in.Body)
	if in.Body == "" || utf8.RuneCountInString(in.Body) > maxChatBody {
		writeError(w, http.StatusBadRequest, "a message needs 1 to 4000 characters")
		return
	}
	m, err := a.Store.EditChat(r.Context(), uid(r), id, in.Body)
	a.chatUpdated(w, r, m, err)
}

func (a *api) deleteChat(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	m, err := a.Store.DeleteChat(r.Context(), uid(r), id)
	a.chatUpdated(w, r, m, err)
}

func (a *api) reactChat(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	var in struct {
		Emoji string `json:"emoji"`
	}
	if r.Method != http.MethodDelete && !readJSON(w, r, &in) {
		return
	}
	if utf8.RuneCountInString(in.Emoji) > 8 {
		writeError(w, http.StatusBadRequest, "one emoji")
		return
	}
	m, err := a.Store.ReactChat(r.Context(), uid(r), id, in.Emoji)
	a.chatUpdated(w, r, m, err)
}

func (a *api) chatUpdated(w http.ResponseWriter, r *http.Request, m *store.ChatMessage, err error) {
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	if err != nil {
		a.serverError(w, "update chat", err)
		return
	}
	a.broadcast(r.Context(), realtime.NewEvent("chat.updated", m))
	writeJSON(w, http.StatusOK, m)
}

func (a *api) readChat(w http.ResponseWriter, r *http.Request) {
	var in struct {
		MessageID uuid.UUID `json:"message_id"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	at, err := a.Store.ReadChat(r.Context(), uid(r), in.MessageID)
	if err != nil {
		a.serverError(w, "read chat", err)
		return
	}
	me := currentUser(r)
	modes := a.visibility(r.Context())
	for _, viewer := range a.memberList(r.Context()) {
		viewer := viewer
		if canSee(modes, &viewer, me, "read_receipts") {
			a.Hub.Send(viewer.ID, realtime.NewEvent("chat.read", store.ChatRead{UserID: me.ID, MessageID: &in.MessageID, ReadAt: at}))
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

const lampEvery = 10 * time.Minute

func (a *api) lampMinutes(ctx context.Context) int {
	if raw, err := a.Store.AppSetting(ctx, "lamp_minutes"); err == nil && raw != nil {
		var n int
		if json.Unmarshal(raw, &n) == nil && n >= 5 && n <= 24*60 {
			return n
		}
	}
	return 60
}

func (a *api) sendLamp(w http.ResponseWriter, r *http.Request) {
	var in struct {
		On bool `json:"on"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	ctx := r.Context()
	me := currentUser(r)
	others := a.others(ctx, me.ID)
	if len(others) == 0 {
		writeError(w, http.StatusConflict, "No one to send it to yet")
		return
	}
	if !in.On {
		for _, u := range others {
			if err := a.Store.LampOff(ctx, me.ID, u.ID); err != nil {
				a.serverError(w, "lamp off", err)
				return
			}
			a.Hub.Send(u.ID, realtime.NewEvent("signal.lamp", map[string]any{"from": me.ID, "to": u.ID, "on": false}))
		}
		a.Hub.Send(me.ID, realtime.NewEvent("signal.lamp", map[string]any{"from": me.ID, "on": false}))
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if last, err := a.Store.LastSignal(ctx, me.ID, "lamp"); err == nil && last != nil && time.Since(*last) < lampEvery {
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "One every 10 minutes", "retry_at": last.Add(lampEvery)})
		return
	}
	until := time.Now().Add(time.Duration(a.lampMinutes(ctx)) * time.Minute)
	var lamps []*store.Lamp
	for _, u := range others {
		l, err := a.Store.SendLamp(ctx, me.ID, u.ID, until)
		if err != nil {
			a.serverError(w, "send lamp", err)
			return
		}
		lamps = append(lamps, l)
		ev := realtime.NewEvent("signal.lamp", map[string]any{"from": me.ID, "to": u.ID, "on": true, "on_until": until, "name": me.DisplayName})
		a.Hub.Send(u.ID, ev)
		a.Hub.Send(me.ID, ev)
		a.notify(u.ID, "lamp", me.DisplayName, "Thinking of you", "/")
	}
	writeJSON(w, http.StatusOK, map[string]any{"lamps": lamps})
}

var notifyDefaults = map[string]bool{"messages": true, "letters": true, "mixtapes": true, "dates": true, "lamp": false, "dedications": false, "swaps": false}

func (a *api) notify(to uuid.UUID, event, title, body, url string) {
	if a.Push == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if a.quiet(ctx, to) {
			return
		}
		on := notifyDefaults[event]
		if raw, err := a.Store.UserSetting(ctx, to, "notify"); err == nil && raw != nil {
			var prefs map[string]bool
			if json.Unmarshal(raw, &prefs) == nil {
				if v, ok := prefs[event]; ok {
					on = v
				}
			}
		}
		if !on {
			return
		}
		subs, err := a.Store.PushSubscriptions(ctx, to)
		if err != nil {
			return
		}
		payload, _ := json.Marshal(map[string]string{"title": title, "body": body, "url": url, "tag": event})
		for _, s := range subs {
			res, err := webpush.SendNotificationWithContext(ctx, payload, &webpush.Subscription{Endpoint: s.Endpoint, Keys: webpush.Keys{P256dh: s.P256dh, Auth: s.Auth}}, &webpush.Options{
				Subscriber: a.Push.Subject, VAPIDPublicKey: a.Push.PublicKey, VAPIDPrivateKey: a.Push.PrivateKey, TTL: 24 * 3600, Urgency: webpush.UrgencyNormal,
			})
			if err != nil {
				a.Log.Warn("web push", "err", err)
				continue
			}
			_ = res.Body.Close()
			if res.StatusCode == http.StatusGone || res.StatusCode == http.StatusNotFound {
				_ = a.Store.DeletePushSubscription(ctx, s.Endpoint)
			} else {
				a.Store.TouchPushSubscription(ctx, s.ID)
			}
		}
	}()
}

type PushKeys struct {
	PublicKey  string
	PrivateKey string
	Subject    string
}

func (a *api) pushKey(w http.ResponseWriter, _ *http.Request) {
	if a.Push == nil {
		writeError(w, http.StatusServiceUnavailable, "notifications are off")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"key": a.Push.PublicKey})
}

func (a *api) subscribePush(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if !strings.HasPrefix(in.Endpoint, "https://") || in.Keys.P256dh == "" || in.Keys.Auth == "" || len(in.Endpoint) > 1000 {
		writeError(w, http.StatusBadRequest, "invalid subscription")
		return
	}
	a.noContent(w, "save push subscription", a.Store.SavePushSubscription(r.Context(), uid(r), in.Endpoint, in.Keys.P256dh, in.Keys.Auth, r.UserAgent()))
}

func (a *api) unsubscribePush(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Endpoint string `json:"endpoint"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	a.noContent(w, "delete push subscription", a.Store.DeletePushSubscription(r.Context(), in.Endpoint))
}

func swapWeek(now time.Time, loc *time.Location) time.Time {
	t := now.In(loc)
	days := (int(time.Friday) - int(t.Weekday()) + 7) % 7
	reveal := time.Date(t.Year(), t.Month(), t.Day()+days, 20, 0, 0, 0, loc)
	if !reveal.After(t) {
		reveal = reveal.AddDate(0, 0, 7)
	}
	return reveal
}

func dateOf(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

func (a *api) swaps(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	reveal := swapWeek(time.Now(), a.homeTZ())
	week := dateOf(reveal)
	picks, err := a.Store.Swaps(ctx, week.AddDate(0, 0, -7*52), week)
	if err != nil {
		a.serverError(w, "swaps", err)
		return
	}
	me := uid(r)
	current := []store.Swap{}
	history := []store.Swap{}
	for _, p := range picks {
		if p.Week == week.Format("2006-01-02") {
			if p.UserID != me {
				p.Track = nil
				p.Note = ""
			}
			current = append(current, p)
		} else {
			history = append(history, p)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"week": week.Format("2006-01-02"), "reveal_at": reveal, "current": current, "history": history})
}

func (a *api) setSwap(w http.ResponseWriter, r *http.Request) {
	var in struct {
		TrackID uuid.UUID `json:"track_id"`
		Note    string    `json:"note"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if utf8.RuneCountInString(in.Note) > 500 {
		writeError(w, http.StatusBadRequest, "the note is too long")
		return
	}
	if _, err := a.Store.Track(r.Context(), in.TrackID); err != nil {
		writeError(w, http.StatusBadRequest, "track not found")
		return
	}
	week := dateOf(swapWeek(time.Now(), a.homeTZ()))
	if err := a.Store.SetSwap(r.Context(), week, uid(r), in.TrackID, strings.TrimSpace(in.Note)); err != nil {
		a.serverError(w, "set swap", err)
		return
	}
	a.broadcast(r.Context(), realtime.NewEvent("swap.update", map[string]any{"user": uid(r), "week": week.Format("2006-01-02")}))
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) homeTZ() *time.Location {
	if a.HomeTZ != nil {
		return a.HomeTZ
	}
	return time.UTC
}
