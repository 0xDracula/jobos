package httpapi

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jobbos/api/internal/realtime"
	"jobbos/api/internal/store"
)

type ChatStore interface {
	PinChat(ctx context.Context, userID, id uuid.UUID, on bool) (*store.ChatMessage, error)
	ChatPins(ctx context.Context, conv uuid.UUID) ([]store.ChatMessage, error)
	ChatAround(ctx context.Context, conv, id uuid.UUID, limit int) ([]store.ChatMessage, error)
	SearchChat(ctx context.Context, conv uuid.UUID, q string, limit int) ([]store.ChatMessage, error)
	ChatStickers(ctx context.Context) ([]store.ChatSticker, error)
	ChatSticker(ctx context.Context, id uuid.UUID) (*store.ChatSticker, error)
	CreateChatSticker(ctx context.Context, by uuid.UUID, name, path, mime string) (*store.ChatSticker, error)
	DeleteChatSticker(ctx context.Context, id uuid.UUID) (string, error)
	ReactSwap(ctx context.Context, week time.Time, pickBy uuid.UUID, emoji string) error
}

func (a *api) registerChatRoutes(r chi.Router) {
	r.Get("/chat/pins", a.chatPins)
	r.Put("/chat/messages/{id}/pin", a.pinChat)
	r.Delete("/chat/messages/{id}/pin", a.pinChat)
	r.Get("/chat/search", a.searchChat)
	r.Get("/chat/stickers", a.chatStickers)
	r.Get("/chat/stickers/{id}/image", a.chatStickerImage)
	r.Get("/chat/effects", a.chatEffects)
	r.Put("/swaps/{week}/{user}/reaction", a.reactSwap)
	r.Post("/swaps/{week}/{user}/reply", a.replySwap)
}

func (a *api) registerChatAdminRoutes(r chi.Router) {
	r.Post("/chat/stickers", a.uploadChatSticker)
	r.Delete("/chat/stickers/{id}", a.deleteChatSticker)
	r.Put("/chat/effects", a.setChatEffects)
}

func truncateRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n]) + "…"
}

var builtInStickers = map[string]bool{
	"kitten-happy": true, "kitten-love": true, "kitten-sleepy": true, "kitten-cry": true,
	"kitten-laugh": true, "kitten-music": true, "kitten-wow": true, "kitten-shy": true,
}

const (
	maxVoiceMs   = 10 * 60 * 1000
	maxVoicePeak = 64
)

func (a *api) mediaData(ctx context.Context, sender uuid.UUID, kind string, raw json.RawMessage, _ uuid.UUID) (json.RawMessage, string) {
	var d struct {
		ClipID     uuid.UUID `json:"clip_id"`
		PhotoID    uuid.UUID `json:"photo_id"`
		Peaks      []float64 `json:"peaks"`
		DurationMs int       `json:"duration_ms"`
		Width      int       `json:"width"`
		Height     int       `json:"height"`
		Sticker    string    `json:"sticker"`
		StickerID  uuid.UUID `json:"sticker_id"`
	}
	if json.Unmarshal(raw, &d) != nil {
		return nil, "invalid data"
	}
	out := map[string]any{}
	switch kind {
	case "voice":
		c, err := a.Store.VoiceClip(ctx, d.ClipID)
		if err != nil || c.AuthorID != sender {
			return nil, "voice clip not found"
		}
		if d.DurationMs <= 0 || d.DurationMs > maxVoiceMs || len(d.Peaks) == 0 || len(d.Peaks) > maxVoicePeak {
			return nil, "a voice note needs its length (10 minutes at most) and 1 to 64 peaks"
		}
		peaks := make([]float64, len(d.Peaks))
		for i, p := range d.Peaks {
			peaks[i] = math.Round(math.Max(0, math.Min(1, p))*100) / 100
		}
		out["clip_id"], out["duration_ms"], out["peaks"] = d.ClipID, d.DurationMs, peaks
	case "photo":
		p, err := a.Store.Photo(ctx, d.PhotoID, true)
		if err != nil || p.UploadedBy != sender || p.AlbumID != nil {
			return nil, "photo not found"
		}
		out["photo_id"] = d.PhotoID
		if d.Width > 0 && d.Height > 0 && d.Width <= 10000 && d.Height <= 10000 {
			out["width"], out["height"] = d.Width, d.Height
		}
	case "sticker":
		switch {
		case d.Sticker != "":
			if !builtInStickers[d.Sticker] {
				return nil, "sticker not found"
			}
			out["sticker"] = d.Sticker
		case d.StickerID != uuid.Nil:
			if _, err := a.Store.ChatSticker(ctx, d.StickerID); err != nil {
				return nil, "sticker not found"
			}
			out["sticker_id"] = d.StickerID
		default:
			return nil, "a sticker message needs sticker or sticker_id"
		}
	}
	b, _ := json.Marshal(out)
	return b, ""
}

func (a *api) pinChat(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "message")
	if !ok {
		return
	}
	m, err := a.Store.PinChat(r.Context(), uid(r), id, r.Method == http.MethodPut)
	a.chatUpdated(w, r, m, err)
}

const maxStickerBytes = 2 << 20

var stickerTypes = map[string]string{".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}

type stickerView struct {
	store.ChatSticker
	URL string `json:"url"`
}

func stickerURL(id uuid.UUID) string { return "/api/chat/stickers/" + id.String() + "/image" }

func (a *api) chatStickers(w http.ResponseWriter, r *http.Request) {
	list, err := a.Store.ChatStickers(r.Context())
	if err != nil {
		a.serverError(w, "stickers", err)
		return
	}
	out := make([]stickerView, 0, len(list))
	for _, s := range list {
		out = append(out, stickerView{s, stickerURL(s.ID)})
	}
	writeJSON(w, http.StatusOK, map[string]any{"stickers": out})
}

func (a *api) chatStickerImage(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "sticker")
	if !ok {
		return
	}
	s, err := a.Store.ChatSticker(r.Context(), id)
	if err != nil {
		a.notFoundOr(w, err, "sticker")
		return
	}
	w.Header().Set("Content-Type", s.Mime)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeFile(w, r, filepath.Join(a.MediaRoot, filepath.FromSlash(s.Path)))
}

func (a *api) uploadChatSticker(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxStickerBytes+1<<20)
	if err := r.ParseMultipartForm(4 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "sticker must be a form with an image of 2 MB at most")
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "file is required")
		return
	}
	defer file.Close()
	ext := strings.ToLower(filepath.Ext(header.Filename))
	mime := stickerTypes[ext]
	if mime == "" || header.Size > maxStickerBytes {
		writeError(w, http.StatusBadRequest, "sticker must be PNG, GIF, WebP or JPEG, 2 MB at most")
		return
	}
	name := strings.TrimSpace(r.FormValue("name"))
	if name == "" {
		name = strings.TrimSuffix(header.Filename, filepath.Ext(header.Filename))
	}
	name = truncateRunes(name, 40)
	path, err := a.saveUpload(file, ext)
	if err != nil {
		a.serverError(w, "save sticker", err)
		return
	}
	s, err := a.Store.CreateChatSticker(r.Context(), uid(r), name, path, mime)
	if err != nil {
		a.serverError(w, "create sticker", err)
		return
	}
	a.broadcast(r.Context(), realtime.NewEvent("chat.stickers", nil))
	writeJSON(w, http.StatusCreated, stickerView{*s, stickerURL(s.ID)})
}

func (a *api) deleteChatSticker(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "sticker")
	if !ok {
		return
	}
	path, err := a.Store.DeleteChatSticker(r.Context(), id)
	if err != nil {
		a.notFoundOr(w, err, "sticker")
		return
	}
	_ = os.Remove(filepath.Join(a.MediaRoot, filepath.FromSlash(path)))
	a.broadcast(r.Context(), realtime.NewEvent("chat.stickers", nil))
	w.WriteHeader(http.StatusNoContent)
}

var chatEffectNames = map[string]bool{"hearts": true, "confetti": true, "sparkles": true, "stars": true}

var defaultChatEffects = map[string]string{"❤️": "hearts", "🎉": "confetti", "✨": "sparkles", "🌙": "stars"}

func (a *api) chatEffectList(ctx context.Context) map[string]string {
	if raw, err := a.Store.AppSetting(ctx, "chat_effects"); err == nil && raw != nil {
		var m map[string]string
		if json.Unmarshal(raw, &m) == nil {
			return m
		}
	}
	return defaultChatEffects
}

func (a *api) chatEffects(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"effects": a.chatEffectList(r.Context())})
}

func (a *api) setChatEffects(w http.ResponseWriter, r *http.Request) {
	var in map[string]string
	if !readJSON(w, r, &in) {
		return
	}
	if len(in) > 20 {
		writeError(w, http.StatusBadRequest, "20 effects at most")
		return
	}
	for emoji, effect := range in {
		if emoji == "" || utf8.RuneCountInString(emoji) > 8 || !chatEffectNames[effect] {
			writeError(w, http.StatusBadRequest, "each entry needs one emoji and an effect: hearts, confetti, sparkles or stars")
			return
		}
	}
	raw, _ := json.Marshal(in)
	if err := a.Store.SetAppSetting(r.Context(), "chat_effects", raw); err != nil {
		a.serverError(w, "save effects", err)
		return
	}
	a.broadcast(r.Context(), realtime.NewEvent("chat.effects", nil))
	writeJSON(w, http.StatusOK, map[string]any{"effects": in})
}

func (a *api) revealedPick(w http.ResponseWriter, r *http.Request) (*store.Swap, time.Time, bool) {
	week, err := time.Parse("2006-01-02", chi.URLParam(r, "week"))
	if err != nil {
		writeError(w, http.StatusNotFound, "pick not found")
		return nil, week, false
	}
	by, err := uuid.Parse(chi.URLParam(r, "user"))
	if err != nil || by == uid(r) {
		writeError(w, http.StatusNotFound, "pick not found")
		return nil, week, false
	}
	if !week.Before(dateOf(swapWeek(time.Now(), a.homeTZ()))) {
		writeError(w, http.StatusConflict, "picks are revealed on Friday at 20:00")
		return nil, week, false
	}
	picks, err := a.Store.Swaps(r.Context(), week, week)
	if err != nil {
		a.serverError(w, "swaps", err)
		return nil, week, false
	}
	for i := range picks {
		if picks[i].UserID == by {
			return &picks[i], week, true
		}
	}
	writeError(w, http.StatusNotFound, "pick not found")
	return nil, week, false
}

func (a *api) reactSwap(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Emoji string `json:"emoji"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if utf8.RuneCountInString(in.Emoji) > 8 {
		writeError(w, http.StatusBadRequest, "one emoji")
		return
	}
	pick, week, ok := a.revealedPick(w, r)
	if !ok {
		return
	}
	if err := a.Store.ReactSwap(r.Context(), week, pick.UserID, in.Emoji); err != nil {
		a.notFoundOr(w, err, "pick")
		return
	}
	a.broadcast(r.Context(), realtime.NewEvent("swap.update", map[string]any{"user": pick.UserID, "week": pick.Week}))
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) replySwap(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ClientKey string `json:"client_key"`
		Body      string `json:"body"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	in.Body = strings.TrimSpace(in.Body)
	if in.ClientKey == "" || len(in.ClientKey) > 64 || in.Body == "" || utf8.RuneCountInString(in.Body) > 1000 {
		writeError(w, http.StatusBadRequest, "a reply needs client_key and 1 to 1000 characters")
		return
	}
	pick, _, ok := a.revealedPick(w, r)
	if !ok {
		return
	}
	data := map[string]any{"week": pick.Week, "pick_by": pick.UserID}
	if t := pick.Track; t != nil {
		data["track_id"] = t.ID
		data["track"] = map[string]any{"id": t.ID, "title": t.Title, "artists": t.Artists, "artwork_url": t.ArtworkURL, "artwork_thumb_url": t.ArtworkThumbURL, "duration_ms": t.DurationMs}
	}
	raw, _ := json.Marshal(data)
	conv, ok := a.chatConv(w, r)
	if !ok {
		return
	}
	a.postChat(w, r, conv, store.ChatInput{ClientKey: in.ClientKey, Kind: "swap", Body: in.Body, Data: raw})
}

func swapRevealWeek(now time.Time, loc *time.Location, notified string) (string, bool) {
	last := swapWeek(now, loc).AddDate(0, 0, -7)
	if now.Sub(last) > 12*time.Hour {
		return "", false
	}
	week := dateOf(last).Format("2006-01-02")
	return week, week != notified
}

func SendSwapReveal(ctx context.Context, d Deps, now time.Time) {
	(&api{Deps: d}).forEachPair(ctx, func(ctx context.Context) { sendSwapReveal(ctx, d, now) })
}

func sendSwapReveal(ctx context.Context, d Deps, now time.Time) {
	if d.Store == nil {
		return
	}
	a := &api{Deps: d}
	notified := ""
	if raw, err := d.Store.AppSetting(ctx, "swaps.revealed"); err == nil && raw != nil {
		notified = strings.Trim(string(raw), `"`)
	}
	week, due := swapRevealWeek(now, a.homeTZ(), notified)
	if !due {
		return
	}
	day, _ := time.Parse("2006-01-02", week)
	picks, err := d.Store.Swaps(ctx, day, day)
	if err != nil || len(picks) < 2 {
		return
	}
	raw, _ := json.Marshal(week)
	if err := d.Store.SetAppSetting(ctx, "swaps.revealed", raw); err != nil {
		return
	}
	for _, u := range a.memberList(ctx) {
		a.notify(u.ID, "swaps", "Song swap", "Both picks are revealed", "/chat/?swap=1")
	}
}
