package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jobbos/api/internal/realtime"
	"jobbos/api/internal/store"
)

func (a *api) registerJamRoutes(r chi.Router) {
	r.Post("/jams", a.startJam)
	r.Get("/jams/{id}", a.getJam)
	r.Patch("/jams/{id}", a.updateJam)
	r.Post("/jams/{id}/invite", a.inviteJam)
	r.Post("/jams/{id}/end", a.endJam)
	r.Post("/jams/link/{token}", a.joinJamLink)
}

func (a *api) jamInvitees(ctx context.Context, s socialStore, me uuid.UUID, ids []uuid.UUID) ([]uuid.UUID, error) {
	ids = uniqueIDs(ids, me)
	if len(ids) == 0 {
		return ids, nil
	}
	people, err := s.PeopleByID(ctx, me, ids)
	if err != nil {
		return nil, err
	}
	out := []uuid.UUID{}
	for _, p := range people {
		if p.Relation.Friend || p.JamInvitesFrom == "everyone" {
			out = append(out, p.ID)
		}
	}
	return out, nil
}

func (a *api) endHostedRooms(ctx context.Context, host uuid.UUID) {
	a.rooms.mu.Lock()
	a.rooms.init()
	var ids []uuid.UUID
	for id, t := range a.rooms.m {
		t.mu.Lock()
		if t.state.Active && t.meta.host == host {
			ids = append(ids, id)
		}
		t.mu.Unlock()
	}
	a.rooms.mu.Unlock()
	for _, id := range ids {
		a.endLive(withRoom(ctx, id))
	}
}

func (a *api) startJam(w http.ResponseWriter, r *http.Request) {
	s := a.needSocial(w)
	if s == nil {
		return
	}
	var in struct {
		TrackIDs       []uuid.UUID `json:"track_ids"`
		PositionMs     int64       `json:"position_ms"`
		Invite         []uuid.UUID `json:"invite"`
		ConversationID *uuid.UUID  `json:"conversation_id"`
		FriendsJoin    *bool       `json:"friends_join"`
		AnyoneAdd      *bool       `json:"anyone_add"`
		AnyoneSkip     *bool       `json:"anyone_skip"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if len(in.TrackIDs) == 0 {
		writeError(w, http.StatusBadRequest, "track_ids is required")
		return
	}
	ctx := r.Context()
	me := currentUser(r)
	invite, err := a.jamInvitees(ctx, s, me.ID, in.Invite)
	if err != nil {
		a.serverError(w, "jam invitees", err)
		return
	}
	var conv *store.Conversation
	if in.ConversationID != nil {
		if conv, err = s.Conversation(ctx, me.ID, *in.ConversationID); err != nil {
			writeError(w, http.StatusNotFound, "conversation not found")
			return
		}
	}
	flag := func(p *bool, def bool) bool {
		if p == nil {
			return def
		}
		return *p
	}
	a.endHostedRooms(ctx, me.ID)
	id, err := s.CreateJam(ctx, me.ID, store.JamInput{TrackIDs: in.TrackIDs, Audience: invite, ConversationID: in.ConversationID,
		FriendsJoin: flag(in.FriendsJoin, true), AnyoneAdd: flag(in.AnyoneAdd, true), AnyoneSkip: flag(in.AnyoneSkip, true)})
	if errors.Is(err, store.ErrSessionLive) {
		writeError(w, http.StatusConflict, "another session is live")
		return
	}
	if err != nil {
		a.serverError(w, "start jam", err)
		return
	}
	sess, err := a.Store.ListeningSessionByID(ctx, id)
	if err != nil {
		a.serverError(w, "jam", err)
		return
	}
	a.goLive(ctx, sess, me.ID)
	rctx := withRoom(ctx, id)
	if in.PositionMs > 3000 {
		t := a.roomOf(rctx)
		t.mu.Lock()
		t.state.PositionAtStartMs = in.PositionMs
		t.mu.Unlock()
	}
	a.saveLive(rctx, true)
	a.publishRoom(rctx)
	a.sendJamInvites(ctx, s, me, sess, invite, conv)
	a.activityChanged(ctx, me.ID)
	writeJSON(w, http.StatusCreated, map[string]any{"id": id})
}

func (a *api) sendJamInvites(ctx context.Context, s socialStore, me *store.User, sess *store.ListeningSession, people []uuid.UUID, conv *store.Conversation) {
	data, _ := json.Marshal(map[string]any{"session_id": sess.ID, "title": me.DisplayName + "'s jam", "jam": true, "songs": sess.ItemCount})
	post := func(c *store.Conversation) {
		m, created, err := a.Store.SendChat(ctx, me.ID, store.ChatInput{ConversationID: c.ID, ClientKey: "jam-" + uuid.NewString(),
			Kind: "session", Body: me.DisplayName + "'s jam", Data: data})
		if err != nil {
			a.Log.Warn("jam card", "err", err)
			return
		}
		if created {
			a.sendToConversation(ctx, c.ID, realtime.NewEvent("chat.message", m))
		}
	}
	if conv != nil {
		post(conv)
	}
	pair := pairOf(ctx)
	for _, id := range people {
		var convID uuid.UUID
		var err error
		if pair != nil && pair.Other(me.ID) != nil && pair.Other(me.ID).ID == id {
			convID, err = s.PairConversation(ctx, pair.ID)
		} else {
			friend, ferr := s.AreFriends(ctx, me.ID, id)
			if ferr != nil {
				continue
			}
			convID, _, err = s.DirectConversation(ctx, me.ID, id, friend)
		}
		if err != nil {
			a.Log.Warn("jam invite chat", "err", err)
			continue
		}
		if conv != nil && conv.ID == convID {
			continue
		}
		if c, err := s.Conversation(ctx, me.ID, convID); err == nil {
			post(c)
		}
		a.notify(id, "together", me.DisplayName, "Invited you to a jam", "/jam/?id="+sess.ID.String())
	}
	if conv != nil {
		for _, m := range conv.Members {
			if m.ID != me.ID {
				a.notify(m.ID, "together", me.DisplayName, "Started a jam", "/jam/?id="+sess.ID.String())
			}
		}
	}
}

func (a *api) jamFor(w http.ResponseWriter, r *http.Request) (*store.ListeningSession, bool) {
	id, ok := urlID(w, r, "jam")
	if !ok {
		return nil, false
	}
	sess, err := a.Store.ListeningSessionByID(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) || (err == nil && sess.PairID != nil) {
		writeError(w, http.StatusNotFound, "jam not found")
		return nil, false
	}
	if err != nil {
		a.serverError(w, "jam", err)
		return nil, false
	}
	return sess, true
}

func (a *api) getJam(w http.ResponseWriter, r *http.Request) {
	s := a.needSocial(w)
	if s == nil {
		return
	}
	sess, ok := a.jamFor(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	me := uid(r)
	ids := append(append([]uuid.UUID{sess.CreatedBy}, sess.Audience...), sess.Members...)
	people, err := s.PeopleByID(ctx, me, uniqueIDs(ids, uuid.Nil))
	if err != nil {
		a.serverError(w, "jam people", err)
		return
	}
	out := map[string]any{"jam": sess, "room": a.together(withRoom(ctx, sess.ID)), "people": people}
	if sess.CreatedBy == me && sess.Status == "live" {
		if token, err := s.JamLink(ctx, sess.ID); err == nil {
			out["link_token"] = token
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *api) updateJam(w http.ResponseWriter, r *http.Request) {
	s := a.needSocial(w)
	if s == nil {
		return
	}
	sess, ok := a.jamFor(w, r)
	if !ok {
		return
	}
	if sess.CreatedBy != uid(r) {
		writeError(w, http.StatusForbidden, "Host only")
		return
	}
	var in struct {
		FriendsJoin *bool `json:"friends_join"`
		AnyoneAdd   *bool `json:"anyone_add"`
		AnyoneSkip  *bool `json:"anyone_skip"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	set := func(p *bool, cur bool) bool {
		if p == nil {
			return cur
		}
		return *p
	}
	fj, aa, as := set(in.FriendsJoin, sess.FriendsJoin), set(in.AnyoneAdd, sess.AnyoneAdd), set(in.AnyoneSkip, sess.AnyoneSkip)
	if err := s.SetJamSettings(r.Context(), sess.ID, fj, aa, as); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusConflict, "this jam has ended")
		return
	} else if err != nil {
		a.serverError(w, "jam settings", err)
		return
	}
	ctx := withRoom(r.Context(), sess.ID)
	t := a.roomOf(ctx)
	t.mu.Lock()
	t.meta.friendsJoin, t.meta.anyoneAdd, t.meta.anyoneSkip = fj, aa, as
	t.state.AnyoneAdd, t.state.AnyoneSkip = aa, as
	t.state.Version++
	t.mu.Unlock()
	a.publishRoom(ctx)
	a.activityChanged(ctx, sess.CreatedBy)
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) inviteJam(w http.ResponseWriter, r *http.Request) {
	s := a.needSocial(w)
	if s == nil {
		return
	}
	sess, ok := a.jamFor(w, r)
	if !ok {
		return
	}
	if sess.Status != "live" {
		writeError(w, http.StatusConflict, "this jam has ended")
		return
	}
	var in struct {
		UserIDs        []uuid.UUID `json:"user_ids"`
		ConversationID *uuid.UUID  `json:"conversation_id"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	ctx := r.Context()
	me := currentUser(r)
	invite, err := a.jamInvitees(ctx, s, me.ID, in.UserIDs)
	if err != nil {
		a.serverError(w, "jam invitees", err)
		return
	}
	var conv *store.Conversation
	if in.ConversationID != nil {
		if conv, err = s.Conversation(ctx, me.ID, *in.ConversationID); err != nil {
			writeError(w, http.StatusNotFound, "conversation not found")
			return
		}
		invite = append(invite, uniqueIDs(conv.MemberIDs(), me.ID)...)
	}
	if len(invite) == 0 {
		writeError(w, http.StatusBadRequest, "no one to invite")
		return
	}
	if err := s.AddJamAudience(ctx, sess.ID, invite); err != nil {
		a.serverError(w, "invite to jam", err)
		return
	}
	rctx := withRoom(ctx, sess.ID)
	t := a.roomOf(rctx)
	t.mu.Lock()
	t.meta.audience = append(t.meta.audience, invite...)
	t.mu.Unlock()
	a.publishRoom(rctx)
	direct := invite
	if conv != nil {
		direct = uniqueIDs(in.UserIDs, me.ID)
	}
	a.sendJamInvites(ctx, s, me, sess, direct, conv)
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) endJam(w http.ResponseWriter, r *http.Request) {
	sess, ok := a.jamFor(w, r)
	if !ok {
		return
	}
	if sess.CreatedBy != uid(r) {
		writeError(w, http.StatusForbidden, "Host only")
		return
	}
	a.endLive(withRoom(r.Context(), sess.ID))
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) joinJamLink(w http.ResponseWriter, r *http.Request) {
	s := a.needSocial(w)
	if s == nil {
		return
	}
	token := chi.URLParam(r, "token")
	all := store.AnyPair(r.Context())
	sess, err := s.JamByLink(all, token)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "This jam has ended")
		return
	}
	if err != nil {
		a.serverError(w, "jam link", err)
		return
	}
	me := uid(r)
	if err := s.AddJamAudience(all, sess.ID, []uuid.UUID{me}); err != nil {
		a.serverError(w, "join jam", err)
		return
	}
	t := a.room(sess.ID)
	t.mu.Lock()
	t.meta.audience = append(t.meta.audience, me)
	t.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"id": sess.ID})
}
