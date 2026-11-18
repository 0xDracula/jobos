package httpapi

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jobbos/api/internal/auth"
	"jobbos/api/internal/realtime"
	"jobbos/api/internal/store"
)

type pairStore interface {
	ActivePair(ctx context.Context, userID uuid.UUID) (*store.Pair, error)
	ActivePairs(ctx context.Context) ([]store.Pair, error)
	Unlink(ctx context.Context, userID uuid.UUID, keep bool) error
	SetPairKind(ctx context.Context, pairID uuid.UUID, kind string) error
	CreateLinkInvite(ctx context.Context, by uuid.UUID, kind string, tokenHash []byte, ttl time.Duration) (*store.Invite, error)
	LinkInvites(ctx context.Context, by uuid.UUID) ([]store.Invite, error)
	RevokeOwnInvite(ctx context.Context, id, by uuid.UUID) error
	AcceptLinkInvite(ctx context.Context, tokenHash []byte, userID uuid.UUID) (*store.Pair, error)
}

func (a *api) pairStore() pairStore {
	ps, _ := a.Store.(pairStore)
	return ps
}

type spaceKey struct{}

type space struct {
	me   uuid.UUID
	pair *store.Pair
}

func withSpace(ctx context.Context, me uuid.UUID, p *store.Pair) context.Context {
	id := uuid.Nil
	if p != nil {
		id = p.ID
	}
	return context.WithValue(store.WithScope(ctx, id, me), spaceKey{}, &space{me: me, pair: p})
}

func spaceOf(ctx context.Context) *space {
	sp, _ := ctx.Value(spaceKey{}).(*space)
	return sp
}

func pairOf(ctx context.Context) *store.Pair {
	if sp := spaceOf(ctx); sp != nil {
		return sp.pair
	}
	return nil
}

var pairCache = struct {
	sync.Mutex
	m map[uuid.UUID]pairEntry
}{m: map[uuid.UUID]pairEntry{}}

type pairEntry struct {
	p  *store.Pair
	at time.Time
}

const pairTTL = 15 * time.Second

func forgetPairs() {
	pairCache.Lock()
	pairCache.m = map[uuid.UUID]pairEntry{}
	pairCache.Unlock()
}

func (a *api) pairFor(ctx context.Context, userID uuid.UUID) (*store.Pair, error) {
	ps := a.pairStore()
	if ps == nil {
		return nil, nil
	}
	pairCache.Lock()
	e, ok := pairCache.m[userID]
	pairCache.Unlock()
	if ok && time.Since(e.at) < pairTTL {
		return e.p, nil
	}
	p, err := ps.ActivePair(ctx, userID)
	if err != nil {
		return nil, err
	}
	pairCache.Lock()
	pairCache.m[userID] = pairEntry{p: p, at: time.Now()}
	pairCache.Unlock()
	return p, nil
}

func (a *api) forEachPair(ctx context.Context, fn func(ctx context.Context)) {
	ps := a.pairStore()
	if ps == nil {
		fn(ctx)
		return
	}
	pairs, err := ps.ActivePairs(store.AnyPair(ctx))
	if err != nil {
		if a.Log != nil {
			a.Log.Warn("list pairs", "err", err)
		}
		return
	}
	for i := range pairs {
		fn(withSpace(ctx, uuid.Nil, &pairs[i]))
	}
}

func (a *api) registerPairRoutes(r chi.Router) {
	r.Get("/pair", a.pairState)
	r.Patch("/pair", a.setPairKind)
	r.Post("/pair/unlink", a.unlink)
	r.Post("/pair/invites", a.createLinkInvite)
	r.Delete("/pair/invites/{id}", a.revokeLinkInvite)
	r.Post("/invites/{token}/link", a.linkByInvite)
}

type pairJSON struct {
	ID        uuid.UUID   `json:"id"`
	Kind      string      `json:"kind"`
	CreatedAt time.Time   `json:"created_at"`
	Partner   *store.User `json:"partner"`
}

func (a *api) pairState(w http.ResponseWriter, r *http.Request) {
	me := uid(r)
	var out *pairJSON
	if p := pairOf(r.Context()); p != nil {
		out = &pairJSON{ID: p.ID, Kind: p.Kind, CreatedAt: p.CreatedAt, Partner: p.Other(me)}
	}
	invites := []store.Invite{}
	if ps := a.pairStore(); ps != nil && out == nil {
		list, err := ps.LinkInvites(r.Context(), me)
		if err != nil {
			a.serverError(w, "link invites", err)
			return
		}
		if list != nil {
			invites = list
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"pair": out, "invites": invites})
}

func (a *api) setPairKind(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Kind string `json:"kind"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	p, ps := pairOf(r.Context()), a.pairStore()
	if p == nil || ps == nil {
		writeError(w, http.StatusConflict, "Not linked")
		return
	}
	if !store.ValidPairKind(in.Kind) {
		writeError(w, http.StatusBadRequest, "kind is partner or friend")
		return
	}
	if err := ps.SetPairKind(r.Context(), p.ID, in.Kind); err != nil {
		a.serverError(w, "set pair kind", err)
		return
	}
	a.pairChanged(r.Context(), p)
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) unlink(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Keep bool `json:"keep"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	p, ps := pairOf(r.Context()), a.pairStore()
	if p == nil || ps == nil {
		writeError(w, http.StatusConflict, "Not linked")
		return
	}
	me := uid(r)
	if err := ps.Unlink(r.Context(), me, in.Keep); err != nil {
		a.serverError(w, "unlink", err)
		return
	}
	a.Store.Audit(r.Context(), &me, "pair.unlink", p.ID.String(), map[string]bool{"keep": in.Keep})
	a.pairChanged(r.Context(), p)
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) pairChanged(ctx context.Context, p *store.Pair) {
	forgetPairs()
	if a.Hub == nil || p == nil {
		return
	}
	for _, u := range p.Members {
		a.Hub.Send(u.ID, realtime.NewEvent("pair.update", nil))
	}
}

func (a *api) createLinkInvite(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Kind string `json:"kind"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	ps := a.pairStore()
	if ps == nil {
		writeError(w, http.StatusNotImplemented, "Linking unavailable")
		return
	}
	if pairOf(r.Context()) != nil {
		writeError(w, http.StatusConflict, "Already linked")
		return
	}
	if !store.ValidPairKind(in.Kind) {
		writeError(w, http.StatusBadRequest, "kind is partner or friend")
		return
	}
	token, hash, err := auth.NewToken()
	if err != nil {
		a.serverError(w, "new token", err)
		return
	}
	me := uid(r)
	inv, err := ps.CreateLinkInvite(r.Context(), me, in.Kind, hash, auth.InviteTTL)
	if err != nil {
		a.serverError(w, "create link invite", err)
		return
	}
	a.Store.Audit(r.Context(), &me, "pair.invite", inv.ID.String(), map[string]string{"kind": in.Kind})
	writeJSON(w, http.StatusCreated, map[string]any{"invite": inv, "path": "/invite/" + token})
}

func (a *api) revokeLinkInvite(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	ps := a.pairStore()
	if err != nil || ps == nil {
		writeError(w, http.StatusNotFound, "invite not found")
		return
	}
	err = ps.RevokeOwnInvite(r.Context(), id, uid(r))
	if errors.Is(err, store.ErrInviteClosed) {
		writeError(w, http.StatusNotFound, "invite not found")
		return
	}
	a.noContent(w, "revoke link invite", err)
}

func (a *api) linkByInvite(w http.ResponseWriter, r *http.Request) {
	hash, ok := a.pageToken(w, r)
	if !ok {
		return
	}
	ps := a.pairStore()
	if ps == nil {
		writeError(w, http.StatusNotImplemented, "Linking unavailable")
		return
	}
	me := uid(r)
	p, err := ps.AcceptLinkInvite(r.Context(), hash, me)
	switch {
	case errors.Is(err, store.ErrInviteClosed):
		writeError(w, http.StatusNotFound, "This link isn't valid anymore")
		return
	case errors.Is(err, store.ErrAlreadyLinked):
		writeError(w, http.StatusConflict, "One of you is already linked")
		return
	case errors.Is(err, store.ErrSelfLink):
		writeError(w, http.StatusBadRequest, "That's your own invite")
		return
	case err != nil:
		a.serverError(w, "accept link invite", err)
		return
	}
	a.Store.Audit(r.Context(), &me, "pair.link", p.ID.String(), nil)
	a.pairChanged(r.Context(), p)
	writeJSON(w, http.StatusOK, map[string]any{"pair": pairJSON{ID: p.ID, Kind: p.Kind, CreatedAt: p.CreatedAt, Partner: p.Other(me)}})
}

func (a *api) spaceFor(ctx context.Context, userID uuid.UUID) context.Context {
	if a.pairStore() == nil {
		return ctx
	}
	p, err := a.pairFor(ctx, userID)
	if err != nil {
		p = nil
	}
	return withSpace(ctx, userID, p)
}
