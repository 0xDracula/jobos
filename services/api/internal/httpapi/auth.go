package httpapi

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jobbos/api/internal/auth"
	"jobbos/api/internal/store"
)

type ctxKey int

const userKey ctxKey = 1

const sessionCookie = "session"

type limits struct {
	loginUser *auth.Limiter
	loginIP   *auth.Limiter
	pages     *auth.Limiter
}

func newLimits() limits {
	return limits{
		loginUser: auth.NewLimiter(5, 15*time.Minute),
		loginIP:   auth.NewLimiter(5, 15*time.Minute),
		pages:     auth.NewLimiter(20, time.Hour),
	}
}

func currentUser(r *http.Request) *store.User {
	u, _ := r.Context().Value(userKey).(*store.User)
	return u
}

func uid(r *http.Request) uuid.UUID {
	if u := currentUser(r); u != nil {
		return u.ID
	}
	return uuid.Nil
}

func isAdmin(r *http.Request) bool {
	u := currentUser(r)
	return u != nil && u.Role == "admin"
}

func (a *api) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
			u, _, err := a.Store.Session(r.Context(), auth.HashToken(c.Value), auth.SessionTTL)
			if err == nil {
				next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey, u)))
				return
			}
			if !errors.Is(err, store.ErrNotFound) {
				a.serverError(w, "load session", err)
				return
			}
		}
		if a.AutoUser != nil {
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey, a.AutoUser)))
			return
		}
		writeError(w, http.StatusUnauthorized, "Sign in to continue")
	})
}

func (a *api) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isAdmin(r) {
			writeError(w, http.StatusForbidden, "Admin only")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func clientAddr(r *http.Request) string {
	if ip := clientIP(r); ip.IsValid() {
		return ip.String()
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func secureRequest(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func (a *api) startSession(w http.ResponseWriter, r *http.Request, userID uuid.UUID) error {
	token, hash, err := auth.NewToken()
	if err != nil {
		return err
	}
	if err := a.Store.CreateSession(r.Context(), userID, hash, r.UserAgent(), clientAddr(r), auth.SessionTTL, auth.MaxSessions); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: token, Path: "/", HttpOnly: true, Secure: secureRequest(r),
		SameSite: http.SameSiteLaxMode, MaxAge: int(auth.SessionTTL / time.Second),
	})
	return nil
}

func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", HttpOnly: true, Secure: secureRequest(r), SameSite: http.SameSiteLaxMode, MaxAge: -1})
}

func (a *api) login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	name := strings.ToLower(strings.TrimSpace(in.Username))
	ip := clientAddr(r)
	if a.limits.loginUser.Blocked(name) || a.limits.loginIP.Blocked(ip) {
		writeError(w, http.StatusTooManyRequests, "Too many attempts. Try again in 15 minutes.")
		return
	}
	u, hash, err := a.Store.Login(r.Context(), name)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		a.serverError(w, "login", err)
		return
	}
	if u == nil || hash == "" || !auth.CheckPassword(hash, in.Password) {
		a.limits.loginUser.Hit(name)
		a.limits.loginIP.Hit(ip)
		writeError(w, http.StatusUnauthorized, "Wrong username or password")
		return
	}
	a.limits.loginUser.Reset(name)
	if err := a.startSession(w, r, u.ID); err != nil {
		a.serverError(w, "start session", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

func (a *api) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
		if err := a.Store.DeleteSession(r.Context(), auth.HashToken(c.Value)); err != nil {
			a.serverError(w, "logout", err)
			return
		}
	}
	clearSessionCookie(w, r)
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) pageToken(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	if !a.limits.pages.Allow(clientAddr(r)) {
		writeError(w, http.StatusTooManyRequests, "Too many requests. Try again later.")
		return nil, false
	}
	token := chi.URLParam(r, "token")
	if len(token) < 20 || len(token) > 100 {
		writeError(w, http.StatusNotFound, "This link isn't valid anymore")
		return nil, false
	}
	return auth.HashToken(token), true
}

func (a *api) invitePage(w http.ResponseWriter, r *http.Request) {
	hash, ok := a.pageToken(w, r)
	if !ok {
		return
	}
	inv, err := a.Store.InviteByToken(r.Context(), hash)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		a.serverError(w, "load invite", err)
		return
	}
	if inv == nil || (inv.Status != "pending" && inv.Status != "declined") {
		writeError(w, http.StatusNotFound, "This link isn't valid anymore")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"invite": map[string]any{
		"display_name": inv.DisplayName, "username": inv.Username, "message": inv.Message, "status": inv.Status, "expires_at": inv.ExpiresAt,
	}})
}

var usernameOK = func(s string) bool {
	if len(s) < 2 || len(s) > 32 {
		return false
	}
	for _, c := range s {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '_' || c == '.' || c == '-') {
			return false
		}
	}
	return true
}

func (a *api) acceptInvite(w http.ResponseWriter, r *http.Request) {
	hash, ok := a.pageToken(w, r)
	if !ok {
		return
	}
	var in struct {
		DisplayName string `json:"display_name"`
		Username    string `json:"username"`
		Password    string `json:"password"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	in.DisplayName = strings.TrimSpace(in.DisplayName)
	in.Username = strings.ToLower(strings.TrimSpace(in.Username))
	if in.DisplayName == "" || len([]rune(in.DisplayName)) > 40 {
		writeError(w, http.StatusBadRequest, "Display name needs 1 to 40 characters")
		return
	}
	if !usernameOK(in.Username) {
		writeError(w, http.StatusBadRequest, "Username needs 2 to 32 characters: letters, digits, dots, dashes or underscores")
		return
	}
	if msg := auth.PasswordProblem(in.Password); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	pw, err := auth.HashPassword(in.Password)
	if err != nil {
		a.serverError(w, "hash password", err)
		return
	}
	u, err := a.Store.AcceptInvite(r.Context(), hash, in.DisplayName, in.Username, pw)
	switch {
	case errors.Is(err, store.ErrUsernameTaken):
		writeError(w, http.StatusConflict, "That username is taken")
		return
	case errors.Is(err, store.ErrInviteClosed):
		writeError(w, http.StatusNotFound, "This link isn't valid anymore")
		return
	case err != nil:
		a.serverError(w, "accept invite", err)
		return
	}
	a.Store.Audit(r.Context(), &u.ID, "invite.accept", u.Username, nil)
	if err := a.applyHerPlaylist(r.Context()); err != nil {
		a.Log.Warn("her playlist", "err", err)
	}
	if err := a.startSession(w, r, u.ID); err != nil {
		a.serverError(w, "start session", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

func (a *api) declineInvite(w http.ResponseWriter, r *http.Request) {
	hash, ok := a.pageToken(w, r)
	if !ok {
		return
	}
	err := a.Store.DeclineInvite(r.Context(), hash)
	if errors.Is(err, store.ErrInviteClosed) {
		writeError(w, http.StatusNotFound, "This link isn't valid anymore")
		return
	}
	if err == nil {
		a.Store.Audit(r.Context(), nil, "invite.decline", "", nil)
	}
	a.noContent(w, "decline invite", err)
}

func (a *api) resetPage(w http.ResponseWriter, r *http.Request) {
	hash, ok := a.pageToken(w, r)
	if !ok {
		return
	}
	u, err := a.Store.PasswordReset(r.Context(), hash)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "This link isn't valid anymore")
		return
	}
	if err != nil {
		a.serverError(w, "load reset", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"username": u.Username})
}

func (a *api) usePasswordReset(w http.ResponseWriter, r *http.Request) {
	hash, ok := a.pageToken(w, r)
	if !ok {
		return
	}
	var in struct {
		Password string `json:"password"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if msg := auth.PasswordProblem(in.Password); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	pw, err := auth.HashPassword(in.Password)
	if err != nil {
		a.serverError(w, "hash password", err)
		return
	}
	u, err := a.Store.UsePasswordReset(r.Context(), hash, pw)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "This link isn't valid anymore")
		return
	}
	if err != nil {
		a.serverError(w, "reset password", err)
		return
	}
	a.Store.Audit(r.Context(), &u.ID, "password.reset", u.Username, nil)
	if err := a.startSession(w, r, u.ID); err != nil {
		a.serverError(w, "start session", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

func (a *api) adminAccounts(w http.ResponseWriter, r *http.Request) {
	accounts, err := a.Store.Accounts(r.Context())
	if err != nil {
		a.serverError(w, "list accounts", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"accounts": accounts})
}

func (a *api) adminResetLink(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "account not found")
		return
	}
	token, hash, err := auth.NewToken()
	if err != nil {
		a.serverError(w, "new token", err)
		return
	}
	if err := a.Store.CreatePasswordReset(r.Context(), id, hash, auth.ResetTTL); err != nil {
		a.serverError(w, "create reset", err)
		return
	}
	me := uid(r)
	a.Store.Audit(r.Context(), &me, "password.reset_link", id.String(), nil)
	writeJSON(w, http.StatusOK, map[string]any{"path": "/reset/" + token, "expires_at": time.Now().Add(auth.ResetTTL)})
}

func (a *api) adminSignOut(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "account not found")
		return
	}
	n, err := a.Store.DeleteUserSessions(r.Context(), id, uuid.Nil)
	if err != nil {
		a.serverError(w, "revoke sessions", err)
		return
	}
	me := uid(r)
	a.Store.Audit(r.Context(), &me, "sessions.revoke", id.String(), map[string]int64{"count": n})
	writeJSON(w, http.StatusOK, map[string]any{"revoked": n})
}

func (a *api) adminInvites(w http.ResponseWriter, r *http.Request) {
	invites, err := a.Store.Invites(r.Context())
	if err != nil {
		a.serverError(w, "list invites", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"invites": invites})
}

func (a *api) createInvite(w http.ResponseWriter, r *http.Request) {
	var in struct {
		DisplayName string `json:"display_name"`
		Username    string `json:"username"`
		Message     string `json:"message"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	in.Username = strings.ToLower(strings.TrimSpace(in.Username))
	if in.Username == "" {
		in.Username = "partner"
	}
	if !usernameOK(in.Username) || len([]rune(in.DisplayName)) > 40 || len([]rune(in.Message)) > 2000 {
		writeError(w, http.StatusBadRequest, "check the name, username and message")
		return
	}
	token, hash, err := auth.NewToken()
	if err != nil {
		a.serverError(w, "new token", err)
		return
	}
	inv, err := a.Store.CreateInvite(r.Context(), uid(r), strings.TrimSpace(in.DisplayName), in.Username, strings.TrimSpace(in.Message), hash, auth.InviteTTL)
	if err != nil {
		a.serverError(w, "create invite", err)
		return
	}
	me := uid(r)
	a.Store.Audit(r.Context(), &me, "invite.create", inv.ID.String(), nil)
	writeJSON(w, http.StatusCreated, map[string]any{"invite": inv, "path": "/invite/" + token})
}

func (a *api) revokeInvite(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "invite not found")
		return
	}
	err = a.Store.RevokeInvite(r.Context(), id)
	if errors.Is(err, store.ErrInviteClosed) {
		writeError(w, http.StatusConflict, "Only pending or declined invites can be revoked")
		return
	}
	if err == nil {
		me := uid(r)
		a.Store.Audit(r.Context(), &me, "invite.revoke", id.String(), nil)
	}
	a.noContent(w, "revoke invite", err)
}

func (a *api) regenerateInvite(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "invite not found")
		return
	}
	token, hash, err := auth.NewToken()
	if err != nil {
		a.serverError(w, "new token", err)
		return
	}
	inv, err := a.Store.RegenerateInvite(r.Context(), id, hash, auth.InviteTTL)
	if errors.Is(err, store.ErrInviteClosed) {
		writeError(w, http.StatusConflict, "Accepted or revoked invites can't get a new link")
		return
	}
	if err != nil {
		a.serverError(w, "regenerate invite", err)
		return
	}
	me := uid(r)
	a.Store.Audit(r.Context(), &me, "invite.regenerate", id.String(), nil)
	writeJSON(w, http.StatusOK, map[string]any{"invite": inv, "path": "/invite/" + token})
}
