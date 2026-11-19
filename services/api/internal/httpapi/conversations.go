package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jobbos/api/internal/realtime"
	"jobbos/api/internal/store"
)

type socialStore interface {
	Privacy(ctx context.Context, userID uuid.UUID) (*store.Privacy, error)
	SetPrivacy(ctx context.Context, userID uuid.UUID, p store.Privacy) error
	PersonByID(ctx context.Context, viewer, id uuid.UUID) (*store.Person, error)
	PersonByUsername(ctx context.Context, viewer uuid.UUID, username string) (*store.Person, error)
	PeopleByID(ctx context.Context, viewer uuid.UUID, ids []uuid.UUID) ([]store.Person, error)
	Follow(ctx context.Context, follower, followee uuid.UUID) (string, error)
	Unfollow(ctx context.Context, follower, followee uuid.UUID) error
	RemoveFollower(ctx context.Context, me, follower uuid.UUID) error
	AcceptFollower(ctx context.Context, me, follower uuid.UUID) error
	FollowEachOther(ctx context.Context, a, b uuid.UUID) error
	FollowRequests(ctx context.Context, me uuid.UUID) ([]store.Person, error)
	Followers(ctx context.Context, viewer, subject uuid.UUID, limit int) ([]store.Person, error)
	Following(ctx context.Context, viewer, subject uuid.UUID, limit int) ([]store.Person, error)
	Friends(ctx context.Context, me uuid.UUID) ([]store.Person, error)
	AreFriends(ctx context.Context, a, b uuid.UUID) (bool, error)
	SearchPeople(ctx context.Context, viewer uuid.UUID, q string, limit int) ([]store.Person, error)
	SuggestedPeople(ctx context.Context, viewer uuid.UUID, limit int) ([]store.Person, error)
	MutualFriends(ctx context.Context, viewer, subject uuid.UUID, limit int) ([]store.Person, error)
	ProfileCounts(ctx context.Context, viewer, subject uuid.UUID) (store.ProfileCounts, error)
	ProfilePlaylists(ctx context.Context, viewer, subject uuid.UUID) ([]store.PlaylistSummary, error)
	LastPlays(ctx context.Context, users []uuid.UUID, since time.Time) (map[uuid.UUID]store.LastPlay, error)
	MostPlayed(ctx context.Context, userID uuid.UUID, days, limit int) ([]store.PlayedTrack, error)

	Conversations(ctx context.Context, me uuid.UUID) ([]store.Conversation, error)
	Conversation(ctx context.Context, me, id uuid.UUID) (*store.Conversation, error)
	ConversationMemberIDs(ctx context.Context, id uuid.UUID) ([]uuid.UUID, error)
	PairConversation(ctx context.Context, pairID uuid.UUID) (uuid.UUID, error)
	DirectConversation(ctx context.Context, me, other uuid.UUID, accepted bool) (uuid.UUID, bool, error)
	CreateGroup(ctx context.Context, me uuid.UUID, title string, members []uuid.UUID) (uuid.UUID, error)
	RenameConversation(ctx context.Context, id uuid.UUID, title string) error
	AddConversationMembers(ctx context.Context, id uuid.UUID, users []uuid.UUID) error
	RemoveConversationMember(ctx context.Context, id, user uuid.UUID) error
	AcceptConversation(ctx context.Context, id, me uuid.UUID) error
	DeleteDirectConversation(ctx context.Context, id uuid.UUID) error

	CreateJam(ctx context.Context, host uuid.UUID, in store.JamInput) (uuid.UUID, error)
	AddJamAudience(ctx context.Context, id uuid.UUID, users []uuid.UUID) error
	SetJamSettings(ctx context.Context, id uuid.UUID, friendsJoin, anyoneAdd, anyoneSkip bool) error
	JamLink(ctx context.Context, id uuid.UUID) (string, error)
	JamByLink(ctx context.Context, token string) (*store.ListeningSession, error)
	LiveSessions(ctx context.Context) ([]store.ListeningSession, error)

	GeneratePreviews(ctx context.Context, userID uuid.UUID, now time.Time, loc *time.Location) (int, error)
	Previews(ctx context.Context, userID uuid.UUID, mode string, limit int) ([]store.Preview, error)
	PreviewsGeneratedAt(ctx context.Context, userID uuid.UUID) (time.Time, error)
	ReactPreview(ctx context.Context, userID, trackID uuid.UUID, reaction string) error
	TrackHighlight(ctx context.Context, trackID uuid.UUID) (*store.Highlight, error)
	EnqueueHighlights(ctx context.Context, trackIDs []uuid.UUID, priority int) error
	SetPlaylistVisibility(ctx context.Context, owner, id uuid.UUID, visibility string) error
	LibraryPlaylists(ctx context.Context, viewer uuid.UUID) ([]store.PlaylistSummary, error)
	PlaylistAccess(ctx context.Context, viewer, id uuid.UUID) (see, edit bool, err error)
}

func (a *api) social() socialStore {
	s, _ := a.Store.(socialStore)
	return s
}

func (a *api) needSocial(w http.ResponseWriter) socialStore {
	s := a.social()
	if s == nil {
		writeError(w, http.StatusServiceUnavailable, "not available")
	}
	return s
}

func (a *api) registerConversationRoutes(r chi.Router) {
	r.Get("/conversations", a.listConversations)
	r.Post("/conversations", a.createConversation)
	r.Get("/conversations/{conv}", a.getConversation)
	r.Patch("/conversations/{conv}", a.renameConversation)
	r.Delete("/conversations/{conv}", a.deleteConversation)
	r.Post("/conversations/{conv}/accept", a.acceptConversation)
	r.Post("/conversations/{conv}/members", a.addConversationMembers)
	r.Delete("/conversations/{conv}/members/{user}", a.removeConversationMember)
	r.Get("/conversations/{conv}/messages", a.chatMessages)
	r.Post("/conversations/{conv}/messages", a.sendChat)
	r.Post("/conversations/{conv}/read", a.readChat)
	r.Get("/conversations/{conv}/pins", a.chatPins)
	r.Get("/conversations/{conv}/search", a.searchChat)
}

func (a *api) pairConversationID(ctx context.Context) uuid.UUID {
	s := a.social()
	p := pairOf(ctx)
	if s == nil || p == nil {
		return uuid.Nil
	}
	id, err := s.PairConversation(ctx, p.ID)
	if err != nil {
		a.Log.Warn("pair conversation", "err", err)
		return uuid.Nil
	}
	return id
}

func (a *api) chatConv(w http.ResponseWriter, r *http.Request) (*store.Conversation, bool) {
	s := a.social()
	if s == nil {
		return &store.Conversation{}, true
	}
	ctx := r.Context()
	var id uuid.UUID
	if raw := chi.URLParam(r, "conv"); raw != "" {
		v, err := uuid.Parse(raw)
		if err != nil {
			writeError(w, http.StatusNotFound, "conversation not found")
			return nil, false
		}
		id = v
	} else if id = a.pairConversationID(ctx); id == uuid.Nil {
		writeError(w, http.StatusConflict, "Not linked")
		return nil, false
	}
	c, err := s.Conversation(ctx, uid(r), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "conversation not found")
		return nil, false
	}
	if err != nil {
		a.serverError(w, "conversation", err)
		return nil, false
	}
	return c, true
}

func (a *api) conversationMembers(ctx context.Context, id uuid.UUID) []uuid.UUID {
	if s := a.social(); s != nil && id != uuid.Nil {
		ids, err := s.ConversationMemberIDs(store.AnyPair(ctx), id)
		if err == nil {
			return ids
		}
		a.Log.Warn("conversation members", "err", err)
	}
	var out []uuid.UUID
	for _, u := range a.memberList(ctx) {
		out = append(out, u.ID)
	}
	return out
}

func (a *api) sendToConversation(ctx context.Context, id uuid.UUID, e realtime.Event) {
	if a.Hub == nil {
		return
	}
	for _, u := range a.conversationMembers(ctx, id) {
		a.Hub.Send(u, e)
	}
}

func (a *api) listConversations(w http.ResponseWriter, r *http.Request) {
	s := a.needSocial(w)
	if s == nil {
		return
	}
	list, err := s.Conversations(r.Context(), uid(r))
	if err != nil {
		a.serverError(w, "conversations", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"conversations": list})
}

func (a *api) getConversation(w http.ResponseWriter, r *http.Request) {
	if c, ok := a.chatConv(w, r); ok {
		writeJSON(w, http.StatusOK, c)
	}
}

func cleanGroupTitle(s string) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > 60 {
		s = string([]rune(s)[:60])
	}
	return s
}

func (a *api) createConversation(w http.ResponseWriter, r *http.Request) {
	s := a.needSocial(w)
	if s == nil {
		return
	}
	var in struct {
		UserID  *uuid.UUID  `json:"user_id"`
		Title   string      `json:"title"`
		Members []uuid.UUID `json:"members"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	ctx := r.Context()
	me := uid(r)
	if in.UserID != nil {
		if p := pairOf(ctx); p != nil && p.Other(me) != nil && p.Other(me).ID == *in.UserID {
			id, err := s.PairConversation(ctx, p.ID)
			if err != nil {
				a.serverError(w, "pair conversation", err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"id": id})
			return
		}
		other, err := s.PersonByID(ctx, me, *in.UserID)
		if errors.Is(err, store.ErrNotFound) || (err == nil && other.Relation.Self) {
			writeError(w, http.StatusNotFound, "person not found")
			return
		}
		if err != nil {
			a.serverError(w, "person", err)
			return
		}
		friend := other.Relation.Friend
		if !friend && other.MessagesFrom != "everyone" {
			writeError(w, http.StatusForbidden, "Messages from friends only")
			return
		}
		id, _, err := s.DirectConversation(ctx, me, other.ID, friend)
		if err != nil {
			a.serverError(w, "direct conversation", err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": id})
		return
	}
	members := uniqueIDs(in.Members, me)
	if len(members) == 0 || len(members) >= store.MaxGroupMembers {
		writeError(w, http.StatusBadRequest, "a group needs 1 to 31 other people")
		return
	}
	if !a.allFriends(w, r, s, members) {
		return
	}
	id, err := s.CreateGroup(ctx, me, cleanGroupTitle(in.Title), members)
	if err != nil {
		a.serverError(w, "create group", err)
		return
	}
	a.sendToConversation(ctx, id, realtime.NewEvent("conversation.update", map[string]any{"id": id}))
	writeJSON(w, http.StatusCreated, map[string]any{"id": id})
}

func (a *api) allFriends(w http.ResponseWriter, r *http.Request, s socialStore, ids []uuid.UUID) bool {
	people, err := s.PeopleByID(r.Context(), uid(r), ids)
	if err != nil {
		a.serverError(w, "people", err)
		return false
	}
	if len(people) != len(ids) {
		writeError(w, http.StatusNotFound, "person not found")
		return false
	}
	for _, p := range people {
		if !p.Relation.Friend {
			writeError(w, http.StatusForbidden, "Friends only")
			return false
		}
	}
	return true
}

func uniqueIDs(ids []uuid.UUID, drop uuid.UUID) []uuid.UUID {
	seen := map[uuid.UUID]bool{drop: true}
	out := []uuid.UUID{}
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

func (a *api) renameConversation(w http.ResponseWriter, r *http.Request) {
	c, ok := a.chatConv(w, r)
	if !ok {
		return
	}
	var in struct {
		Title string `json:"title"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if c.Kind != store.ConversationGroup {
		writeError(w, http.StatusBadRequest, "only a group has a title")
		return
	}
	if err := a.social().RenameConversation(r.Context(), c.ID, cleanGroupTitle(in.Title)); err != nil {
		a.serverError(w, "rename conversation", err)
		return
	}
	a.sendToConversation(r.Context(), c.ID, realtime.NewEvent("conversation.update", map[string]any{"id": c.ID}))
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) addConversationMembers(w http.ResponseWriter, r *http.Request) {
	c, ok := a.chatConv(w, r)
	if !ok {
		return
	}
	var in struct {
		UserIDs []uuid.UUID `json:"user_ids"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	s := a.social()
	add := uniqueIDs(in.UserIDs, uid(r))
	if c.Kind != store.ConversationGroup || len(add) == 0 || len(c.Members)+len(add) > store.MaxGroupMembers {
		writeError(w, http.StatusBadRequest, "a group holds 32 people at most")
		return
	}
	if !a.allFriends(w, r, s, add) {
		return
	}
	if err := s.AddConversationMembers(r.Context(), c.ID, add); err != nil {
		a.serverError(w, "add members", err)
		return
	}
	a.sendToConversation(r.Context(), c.ID, realtime.NewEvent("conversation.update", map[string]any{"id": c.ID}))
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) removeConversationMember(w http.ResponseWriter, r *http.Request) {
	c, ok := a.chatConv(w, r)
	if !ok {
		return
	}
	target, err := uuid.Parse(chi.URLParam(r, "user"))
	if err != nil || !c.Has(target) {
		writeError(w, http.StatusNotFound, "member not found")
		return
	}
	me := uid(r)
	if c.Kind != store.ConversationGroup || (target != me && c.Role != "owner") {
		writeError(w, http.StatusForbidden, "Not allowed")
		return
	}
	before := c.MemberIDs()
	if err := a.social().RemoveConversationMember(r.Context(), c.ID, target); err != nil {
		a.serverError(w, "remove member", err)
		return
	}
	if a.Hub != nil {
		e := realtime.NewEvent("conversation.update", map[string]any{"id": c.ID})
		for _, u := range before {
			a.Hub.Send(u, e)
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) acceptConversation(w http.ResponseWriter, r *http.Request) {
	c, ok := a.chatConv(w, r)
	if !ok {
		return
	}
	if err := a.social().AcceptConversation(r.Context(), c.ID, uid(r)); err != nil {
		a.serverError(w, "accept conversation", err)
		return
	}
	a.sendToConversation(r.Context(), c.ID, realtime.NewEvent("conversation.update", map[string]any{"id": c.ID}))
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) deleteConversation(w http.ResponseWriter, r *http.Request) {
	c, ok := a.chatConv(w, r)
	if !ok {
		return
	}
	if c.Kind != store.ConversationDirect || c.Partner {
		writeError(w, http.StatusBadRequest, "leave a group instead")
		return
	}
	members := c.MemberIDs()
	if err := a.social().DeleteDirectConversation(r.Context(), c.ID); err != nil {
		a.serverError(w, "delete conversation", err)
		return
	}
	if a.Hub != nil {
		e := realtime.NewEvent("conversation.update", map[string]any{"id": c.ID, "deleted": true})
		for _, u := range members {
			a.Hub.Send(u, e)
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) chatPins(w http.ResponseWriter, r *http.Request) {
	c, ok := a.chatConv(w, r)
	if !ok {
		return
	}
	pins, err := a.Store.ChatPins(r.Context(), c.ID)
	if err != nil {
		a.serverError(w, "chat pins", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": pins})
}

func (a *api) searchChat(w http.ResponseWriter, r *http.Request) {
	c, ok := a.chatConv(w, r)
	if !ok {
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if utf8.RuneCountInString(q) > 100 {
		writeError(w, http.StatusBadRequest, "search of 100 characters at most")
		return
	}
	msgs, err := a.Store.SearchChat(r.Context(), c.ID, q, intParam(r, "limit", 50, 100))
	if err != nil {
		a.serverError(w, "search chat", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": msgs})
}

func chatPreviewFor(c *store.Conversation, sender *store.User, m *store.ChatMessage) (title, body string) {
	if c != nil && c.Kind == store.ConversationGroup {
		t := c.Title
		if t == "" {
			t = "Group"
		}
		return t, sender.DisplayName + ": " + chatPreview(m)
	}
	return sender.DisplayName, chatPreview(m)
}

func (a *api) uploadConversation(w http.ResponseWriter, r *http.Request) (context.Context, bool) {
	ctx := r.Context()
	raw := r.FormValue("conversation_id")
	s := a.social()
	if raw == "" || s == nil {
		return ctx, true
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		writeError(w, http.StatusNotFound, "conversation not found")
		return nil, false
	}
	c, err := s.Conversation(ctx, uid(r), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "conversation not found")
		return nil, false
	}
	if c.Partner {
		return ctx, true
	}
	return store.WithConversation(ctx, c.ID), true
}

var _ = json.Marshal
