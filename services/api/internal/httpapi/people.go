package httpapi

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jobbos/api/internal/realtime"
	"jobbos/api/internal/store"
)

func init() {
	notifyDefaults["follows"] = true
}

func (a *api) registerPeopleRoutes(r chi.Router) {
	r.Get("/people", a.searchPeople)
	r.Get("/people/suggested", a.suggestedPeople)
	r.Get("/people/{who}", a.profile)
	r.Get("/people/{who}/followers", a.profileFollowers)
	r.Get("/people/{who}/following", a.profileFollowing)
	r.Put("/people/{who}/follow", a.follow)
	r.Delete("/people/{who}/follow", a.unfollow)
	r.Delete("/people/{who}/follower", a.removeFollower)
	r.Post("/people/{who}/accept", a.acceptFollower)
	r.Get("/follow-requests", a.followRequests)
	r.Get("/friends", a.friendsActivity)
	r.Get("/privacy", a.getPrivacy)
	r.Put("/privacy", a.putPrivacy)
	r.Put("/playlists/{id}/visibility", a.playlistVisibility)
}

func (a *api) personAt(w http.ResponseWriter, r *http.Request, s socialStore) (*store.Person, bool) {
	who := chi.URLParam(r, "who")
	var p *store.Person
	var err error
	if id, perr := uuid.Parse(who); perr == nil {
		p, err = s.PersonByID(r.Context(), uid(r), id)
	} else {
		p, err = s.PersonByUsername(r.Context(), uid(r), who)
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "person not found")
		return nil, false
	}
	if err != nil {
		a.serverError(w, "person", err)
		return nil, false
	}
	return p, true
}

func (a *api) activityVisible(viewer *store.User, p *store.Person, modes map[string]string, now time.Time) bool {
	if p.Relation.Self {
		return true
	}
	if p.PrivateUntil != nil && p.PrivateUntil.After(now) || p.ActivityAudience == store.AudienceNone {
		return false
	}
	if p.Relation.Partner {
		return canSee(modes, viewer, &store.User{ID: p.ID}, "listening_status")
	}
	switch p.ActivityAudience {
	case store.AudienceFollowers:
		return p.Relation.Following
	case store.AudienceFriends:
		return p.Relation.Friend
	}
	return false
}

func profileVisible(p *store.Person) bool {
	return !p.Private || p.Relation.Self || p.Relation.Following || p.Relation.Partner
}

func (a *api) searchPeople(w http.ResponseWriter, r *http.Request) {
	s := a.needSocial(w)
	if s == nil {
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" || len(q) > 80 {
		writeJSON(w, http.StatusOK, map[string]any{"people": []store.Person{}})
		return
	}
	people, err := s.SearchPeople(r.Context(), uid(r), q, intParam(r, "limit", 20, 50))
	if err != nil {
		a.serverError(w, "search people", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"people": people})
}

func (a *api) suggestedPeople(w http.ResponseWriter, r *http.Request) {
	s := a.needSocial(w)
	if s == nil {
		return
	}
	people, err := s.SuggestedPeople(r.Context(), uid(r), intParam(r, "limit", 10, 30))
	if err != nil {
		a.serverError(w, "suggested people", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"people": people})
}

func (a *api) profile(w http.ResponseWriter, r *http.Request) {
	s := a.needSocial(w)
	if s == nil {
		return
	}
	p, ok := a.personAt(w, r, s)
	if !ok {
		return
	}
	ctx := r.Context()
	me := currentUser(r)
	counts, err := s.ProfileCounts(ctx, me.ID, p.ID)
	if err != nil {
		a.serverError(w, "profile counts", err)
		return
	}
	out := map[string]any{"person": p, "counts": counts, "visible": profileVisible(p)}
	if !profileVisible(p) {
		writeJSON(w, http.StatusOK, out)
		return
	}
	playlists, err := s.ProfilePlaylists(ctx, me.ID, p.ID)
	if err != nil {
		a.serverError(w, "profile playlists", err)
		return
	}
	out["playlists"] = playlists
	if !p.Relation.Self {
		mutual, err := s.MutualFriends(ctx, me.ID, p.ID, 10)
		if err != nil {
			a.serverError(w, "mutual friends", err)
			return
		}
		out["mutual"] = mutual
	}
	if a.activityVisible(me, p, a.visibility(ctx), time.Now()) {
		top, err := s.MostPlayed(ctx, p.ID, 30, 5)
		if err != nil {
			a.serverError(w, "top songs", err)
			return
		}
		out["top"] = top
		if now, err := a.Store.ListeningNow(ctx); err == nil {
			if n, playing := now[p.ID]; playing && a.Hub != nil && a.Hub.Online(p.ID) {
				if t, err := a.Store.Track(ctx, n.TrackID); err == nil {
					out["playing"] = nowPlayingView{TrackID: t.ID, Title: t.Title, Artists: t.Artists, ArtworkThumbURL: t.ArtworkThumbURL,
						PositionMs: n.PositionMs, Device: n.DeviceName, At: n.UpdatedAt}
				}
			}
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *api) profileFollowers(w http.ResponseWriter, r *http.Request) {
	a.followList(w, r, true)
}

func (a *api) profileFollowing(w http.ResponseWriter, r *http.Request) {
	a.followList(w, r, false)
}

func (a *api) followList(w http.ResponseWriter, r *http.Request, followers bool) {
	s := a.needSocial(w)
	if s == nil {
		return
	}
	p, ok := a.personAt(w, r, s)
	if !ok {
		return
	}
	if !profileVisible(p) {
		writeError(w, http.StatusForbidden, "Private account")
		return
	}
	var people []store.Person
	var err error
	if followers {
		people, err = s.Followers(r.Context(), uid(r), p.ID, 500)
	} else {
		people, err = s.Following(r.Context(), uid(r), p.ID, 500)
	}
	if err != nil {
		a.serverError(w, "follow list", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"people": people})
}

func (a *api) peopleChanged(ids ...uuid.UUID) {
	if a.Hub == nil {
		return
	}
	e := realtime.NewEvent("people.update", map[string]any{"users": ids})
	for _, id := range ids {
		a.Hub.Send(id, e)
	}
}

func (a *api) follow(w http.ResponseWriter, r *http.Request) {
	s := a.needSocial(w)
	if s == nil {
		return
	}
	p, ok := a.personAt(w, r, s)
	if !ok {
		return
	}
	me := currentUser(r)
	status, err := s.Follow(r.Context(), me.ID, p.ID)
	if errors.Is(err, store.ErrSelfFollow) {
		writeError(w, http.StatusBadRequest, "can't follow yourself")
		return
	}
	if err != nil {
		a.serverError(w, "follow", err)
		return
	}
	if !p.Relation.Following && !p.Relation.Requested {
		body := "Followed you"
		if status == "requested" {
			body = "Asked to follow you"
		} else if p.Relation.FollowsYou {
			body = "Followed you back"
		}
		a.notify(p.ID, "follows", me.DisplayName, body, "/people/?u="+me.Username)
	}
	a.peopleChanged(me.ID, p.ID)
	writeJSON(w, http.StatusOK, map[string]any{"status": status})
}

func (a *api) unfollow(w http.ResponseWriter, r *http.Request) {
	s := a.needSocial(w)
	if s == nil {
		return
	}
	p, ok := a.personAt(w, r, s)
	if !ok {
		return
	}
	if err := s.Unfollow(r.Context(), uid(r), p.ID); err != nil {
		a.serverError(w, "unfollow", err)
		return
	}
	a.peopleChanged(uid(r), p.ID)
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) removeFollower(w http.ResponseWriter, r *http.Request) {
	s := a.needSocial(w)
	if s == nil {
		return
	}
	p, ok := a.personAt(w, r, s)
	if !ok {
		return
	}
	if err := s.RemoveFollower(r.Context(), uid(r), p.ID); err != nil {
		a.serverError(w, "remove follower", err)
		return
	}
	a.peopleChanged(uid(r), p.ID)
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) acceptFollower(w http.ResponseWriter, r *http.Request) {
	s := a.needSocial(w)
	if s == nil {
		return
	}
	p, ok := a.personAt(w, r, s)
	if !ok {
		return
	}
	me := currentUser(r)
	if err := s.AcceptFollower(r.Context(), me.ID, p.ID); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "no request from this person")
		return
	} else if err != nil {
		a.serverError(w, "accept follower", err)
		return
	}
	a.notify(p.ID, "follows", me.DisplayName, "Accepted your request", "/people/?u="+me.Username)
	a.peopleChanged(me.ID, p.ID)
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) followRequests(w http.ResponseWriter, r *http.Request) {
	s := a.needSocial(w)
	if s == nil {
		return
	}
	people, err := s.FollowRequests(r.Context(), uid(r))
	if err != nil {
		a.serverError(w, "follow requests", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"people": people})
}

type lastPlayView struct {
	Track store.TrackView `json:"track"`
	At    time.Time       `json:"at"`
}

type friendActivity struct {
	Person  store.Person    `json:"person"`
	Online  *bool           `json:"online"`
	Playing *nowPlayingView `json:"playing,omitempty"`
	Last    *lastPlayView   `json:"last,omitempty"`
	JamID   *uuid.UUID      `json:"jam_id,omitempty"`
}

type jamView struct {
	ID      uuid.UUID        `json:"id"`
	Host    store.Person     `json:"host"`
	Members []uuid.UUID      `json:"members"`
	Track   *store.TrackView `json:"track"`
	Playing bool             `json:"playing"`
	Joined  bool             `json:"joined"`
}

func (a *api) friendsActivity(w http.ResponseWriter, r *http.Request) {
	s := a.needSocial(w)
	if s == nil {
		return
	}
	ctx := r.Context()
	me := currentUser(r)
	friends, err := s.Friends(ctx, me.ID)
	if err != nil {
		a.serverError(w, "friends", err)
		return
	}
	modes := a.visibility(ctx)
	now := time.Now()
	playing, err := a.Store.ListeningNow(ctx)
	if err != nil {
		a.serverError(w, "listening now", err)
		return
	}
	var visible []uuid.UUID
	for i := range friends {
		if a.activityVisible(me, &friends[i], modes, now) {
			visible = append(visible, friends[i].ID)
		}
	}
	last, err := s.LastPlays(ctx, visible, now.Add(-24*time.Hour))
	if err != nil {
		a.serverError(w, "last plays", err)
		return
	}
	trackIDs := []uuid.UUID{}
	for _, p := range last {
		trackIDs = append(trackIDs, p.TrackID)
	}
	for _, id := range visible {
		if n, ok := playing[id]; ok {
			trackIDs = append(trackIDs, n.TrackID)
		}
	}
	tracks, err := a.Store.TracksByID(ctx, trackIDs)
	if err != nil {
		a.serverError(w, "tracks", err)
		return
	}
	byID := map[uuid.UUID]store.TrackView{}
	for _, t := range tracks {
		byID[t.ID] = t
	}
	jams := a.visibleJams(ctx, s, me.ID)
	inJam := map[uuid.UUID]uuid.UUID{}
	for _, j := range jams {
		for _, m := range j.Members {
			inJam[m] = j.ID
		}
	}
	shown := map[uuid.UUID]bool{}
	for _, id := range visible {
		shown[id] = true
	}
	out := make([]friendActivity, 0, len(friends))
	for _, f := range friends {
		fa := friendActivity{Person: f}
		if shown[f.ID] {
			on := a.Hub != nil && a.Hub.Online(f.ID)
			fa.Online = &on
			if n, ok := playing[f.ID]; ok && on {
				if t, ok := byID[n.TrackID]; ok {
					fa.Playing = &nowPlayingView{TrackID: t.ID, Title: t.Title, Artists: t.Artists, ArtworkThumbURL: t.ArtworkThumbURL,
						PositionMs: n.PositionMs, Device: n.DeviceName, At: n.UpdatedAt}
				}
			}
			if p, ok := last[f.ID]; ok {
				if t, ok := byID[p.TrackID]; ok {
					fa.Last = &lastPlayView{Track: t, At: p.At}
				}
			}
			if j, ok := inJam[f.ID]; ok {
				j := j
				fa.JamID = &j
			}
		}
		out = append(out, fa)
	}
	rank := func(f friendActivity) int {
		switch {
		case f.JamID != nil:
			return 0
		case f.Playing != nil:
			return 1
		case f.Last != nil:
			return 2
		}
		return 3
	}
	sort.SliceStable(out, func(i, j int) bool {
		ri, rj := rank(out[i]), rank(out[j])
		if ri != rj {
			return ri < rj
		}
		if ri == 2 {
			return out[i].Last.At.After(out[j].Last.At)
		}
		return false
	})
	writeJSON(w, http.StatusOK, map[string]any{"friends": out, "jams": jams})
}

func (a *api) visibleJams(ctx context.Context, s socialStore, me uuid.UUID) []jamView {
	list, err := s.LiveSessions(ctx)
	if err != nil {
		a.Log.Warn("live sessions", "err", err)
		return []jamView{}
	}
	out := []jamView{}
	for i := range list {
		sess := &list[i]
		if sess.PairID != nil {
			continue
		}
		st := a.together(withRoom(ctx, sess.ID))
		if !st.Active {
			continue
		}
		host, err := s.PersonByID(ctx, me, sess.CreatedBy)
		if err != nil {
			continue
		}
		j := jamView{ID: sess.ID, Host: *host, Members: st.Members, Playing: st.Playing, Joined: containsID(st.Members, me)}
		if st.Index >= 0 && st.Index < len(st.Queue) {
			if t, err := a.Store.Track(ctx, st.Queue[st.Index].TrackID); err == nil {
				j.Track = t
			}
		}
		out = append(out, j)
	}
	return out
}

func (a *api) activityChanged(_ context.Context, user uuid.UUID) {
	s := a.social()
	if s == nil || a.Hub == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		friends, err := s.Friends(store.AnyPair(ctx), user)
		if err != nil {
			return
		}
		e := realtime.NewEvent("activity.update", map[string]any{"user": user})
		for _, f := range friends {
			a.Hub.Send(f.ID, e)
		}
		a.Hub.Send(user, e)
	}()
}

func (a *api) getPrivacy(w http.ResponseWriter, r *http.Request) {
	s := a.needSocial(w)
	if s == nil {
		return
	}
	p, err := s.Privacy(r.Context(), uid(r))
	if err != nil {
		a.serverError(w, "privacy", err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (a *api) putPrivacy(w http.ResponseWriter, r *http.Request) {
	s := a.needSocial(w)
	if s == nil {
		return
	}
	var in struct {
		store.Privacy
		PrivateSessionHours *int `json:"private_session_hours"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	p := in.Privacy
	if in.PrivateSessionHours != nil {
		switch h := *in.PrivateSessionHours; {
		case h <= 0:
			p.PrivateUntil = nil
		case h <= 24:
			until := time.Now().Add(time.Duration(h) * time.Hour)
			p.PrivateUntil = &until
		default:
			writeError(w, http.StatusBadRequest, "a private session lasts 24 hours at most")
			return
		}
	}
	if err := p.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	me := uid(r)
	if err := s.SetPrivacy(r.Context(), me, p); err != nil {
		a.serverError(w, "save privacy", err)
		return
	}
	a.activityChanged(r.Context(), me)
	a.peopleChanged(me)
	out, err := s.Privacy(r.Context(), me)
	if err != nil {
		a.serverError(w, "privacy", err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

var playlistVisibilities = map[string]bool{"public": true, "friends": true, "partner": true, "private": true}

func (a *api) playlistVisibility(w http.ResponseWriter, r *http.Request) {
	s := a.needSocial(w)
	if s == nil {
		return
	}
	id, ok := urlID(w, r, "playlist")
	if !ok {
		return
	}
	var in struct {
		Visibility string `json:"visibility"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if !playlistVisibilities[in.Visibility] {
		writeError(w, http.StatusBadRequest, "visibility must be public, friends, partner or private")
		return
	}
	if err := s.SetPlaylistVisibility(r.Context(), uid(r), id, in.Visibility); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "playlist not found")
		return
	} else if err != nil {
		a.serverError(w, "playlist visibility", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) playlistGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s := a.social()
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if s == nil || err != nil {
			next.ServeHTTP(w, r)
			return
		}
		see, edit, err := s.PlaylistAccess(r.Context(), uid(r), id)
		switch {
		case errors.Is(err, store.ErrNotFound):
			writeError(w, http.StatusNotFound, "playlist not found")
		case err != nil:
			a.serverError(w, "playlist access", err)
		case r.Method == http.MethodGet && see, edit:
			next.ServeHTTP(w, r)
		case see:
			writeError(w, http.StatusForbidden, "Owner only")
		default:
			writeError(w, http.StatusNotFound, "playlist not found")
		}
	})
}
