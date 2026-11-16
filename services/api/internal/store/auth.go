package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	ErrUsernameTaken = errors.New("username taken")
	ErrInviteClosed  = errors.New("invite closed")
)

func (s *Store) Login(ctx context.Context, username string) (*User, string, error) {
	var u User
	var hash *string
	err := s.pool.QueryRow(ctx, `select id, username, display_name, role, password_hash from users where lower(username) = lower($1)`,
		strings.TrimSpace(username)).Scan(&u.ID, &u.Username, &u.DisplayName, &u.Role, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", ErrNotFound
	}
	if err != nil {
		return nil, "", err
	}
	if hash == nil {
		return &u, "", nil
	}
	return &u, *hash, nil
}

func (s *Store) SeedAdminPassword(ctx context.Context, adminID uuid.UUID, hash string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `update users set password_hash = $2, updated_at = now() where id = $1 and password_hash is null`, adminID, hash)
	return tag.RowsAffected() == 1, err
}

func (s *Store) CreateSession(ctx context.Context, userID uuid.UUID, tokenHash []byte, userAgent, ip string, ttl time.Duration, max int) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `insert into sessions (id, user_id, token_hash, user_agent, ip, expires_at) values ($1, $2, $3, nullif($4, ''), nullif($5, ''), now() + $6::interval)`,
		newID(), userID, tokenHash, truncate(userAgent, 300), ip, ttl.String()); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `delete from sessions where user_id = $1 and id not in (
		select id from sessions where user_id = $1 order by last_used_at desc limit $2)`, userID, max); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) Session(ctx context.Context, tokenHash []byte, ttl time.Duration) (*User, uuid.UUID, error) {
	var u User
	var sid uuid.UUID
	var lastUsed time.Time
	err := s.pool.QueryRow(ctx, `select u.id, u.username, u.display_name, u.role, s.id, s.last_used_at
		from sessions s join users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > now()`, tokenHash).
		Scan(&u.ID, &u.Username, &u.DisplayName, &u.Role, &sid, &lastUsed)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, uuid.Nil, ErrNotFound
	}
	if err != nil {
		return nil, uuid.Nil, err
	}
	if time.Since(lastUsed) > time.Hour {
		_, _ = s.pool.Exec(ctx, `update sessions set last_used_at = now(), expires_at = now() + $2::interval where id = $1`, sid, ttl.String())
	}
	return &u, sid, nil
}

func (s *Store) DeleteSession(ctx context.Context, tokenHash []byte) error {
	_, err := s.pool.Exec(ctx, `delete from sessions where token_hash = $1`, tokenHash)
	return err
}

func (s *Store) DeleteUserSessions(ctx context.Context, userID uuid.UUID, keep uuid.UUID) (int64, error) {
	tag, err := s.pool.Exec(ctx, `delete from sessions where user_id = $1 and id <> $2`, userID, keep)
	return tag.RowsAffected(), err
}

type Account struct {
	User
	LastSeenAt *time.Time `json:"last_seen_at"`
	Sessions   int        `json:"sessions"`
	CreatedAt  time.Time  `json:"created_at"`
}

func (s *Store) Accounts(ctx context.Context) ([]Account, error) {
	rows, err := s.pool.Query(ctx, `select u.id, u.username, u.display_name, u.role, u.last_seen_at, u.created_at,
		(select count(*) from sessions s where s.user_id = u.id and s.expires_at > now())
		from users u order by u.created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Account
	for rows.Next() {
		var a Account
		if err := rows.Scan(&a.ID, &a.Username, &a.DisplayName, &a.Role, &a.LastSeenAt, &a.CreatedAt, &a.Sessions); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Store) Members(ctx context.Context) ([]User, error) {
	rows, err := s.pool.Query(ctx, `select id, username, display_name, role, avatar from users order by created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		var avatar []byte
		if err := rows.Scan(&u.ID, &u.Username, &u.DisplayName, &u.Role, &avatar); err != nil {
			return nil, err
		}
		if len(avatar) > 0 {
			u.Avatar = avatar
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

type Invite struct {
	ID          uuid.UUID  `json:"id"`
	DisplayName string     `json:"display_name"`
	Username    string     `json:"username"`
	Message     string     `json:"message"`
	Status      string     `json:"status"`
	CreatedAt   time.Time  `json:"created_at"`
	ExpiresAt   time.Time  `json:"expires_at"`
	RespondedAt *time.Time `json:"responded_at"`
}

const inviteCols = `id, display_name, username, message,
	case when status in ('pending', 'declined') and expires_at <= now() then 'expired' else status end,
	created_at, expires_at, responded_at`

func scanInvite(row pgx.Row) (*Invite, error) {
	var i Invite
	err := row.Scan(&i.ID, &i.DisplayName, &i.Username, &i.Message, &i.Status, &i.CreatedAt, &i.ExpiresAt, &i.RespondedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &i, err
}

func (s *Store) CreateInvite(ctx context.Context, by uuid.UUID, displayName, username, message string, tokenHash []byte, ttl time.Duration) (*Invite, error) {
	return scanInvite(s.pool.QueryRow(ctx, `insert into invites (id, token_hash, display_name, username, message, created_by, expires_at)
		values ($1, $2, $3, $4, $5, $6, now() + $7::interval) returning `+inviteCols,
		newID(), tokenHash, displayName, username, message, by, ttl.String()))
}

func (s *Store) Invites(ctx context.Context) ([]Invite, error) {
	rows, err := s.pool.Query(ctx, `select `+inviteCols+` from invites order by created_at desc`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Invite
	for rows.Next() {
		i, err := scanInvite(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *i)
	}
	return out, rows.Err()
}

func (s *Store) InviteByToken(ctx context.Context, tokenHash []byte) (*Invite, error) {
	return scanInvite(s.pool.QueryRow(ctx, `select `+inviteCols+` from invites where token_hash = $1`, tokenHash))
}

func (s *Store) RevokeInvite(ctx context.Context, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `update invites set status = 'revoked' where id = $1 and status in ('pending', 'declined')`, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrInviteClosed
	}
	return err
}

func (s *Store) RegenerateInvite(ctx context.Context, id uuid.UUID, tokenHash []byte, ttl time.Duration) (*Invite, error) {
	inv, err := scanInvite(s.pool.QueryRow(ctx, `update invites set token_hash = $2, expires_at = now() + $3::interval, status = 'pending', responded_at = null
		where id = $1 and status in ('pending', 'declined') returning `+inviteCols, id, tokenHash, ttl.String()))
	if errors.Is(err, ErrNotFound) {
		return nil, ErrInviteClosed
	}
	return inv, err
}

func (s *Store) DeclineInvite(ctx context.Context, tokenHash []byte) error {
	tag, err := s.pool.Exec(ctx, `update invites set status = 'declined', responded_at = now()
		where token_hash = $1 and status in ('pending', 'declined') and expires_at > now()`, tokenHash)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrInviteClosed
	}
	return err
}

func (s *Store) AcceptInvite(ctx context.Context, tokenHash []byte, displayName, username, passwordHash string) (*User, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var inviteID uuid.UUID
	err = tx.QueryRow(ctx, `select id from invites where token_hash = $1 and status in ('pending', 'declined') and expires_at > now() for update`, tokenHash).Scan(&inviteID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrInviteClosed
	}
	if err != nil {
		return nil, err
	}
	var taken bool
	if err := tx.QueryRow(ctx, `select exists (select 1 from users where lower(username) = lower($1))`, username).Scan(&taken); err != nil {
		return nil, err
	}
	if taken {
		return nil, ErrUsernameTaken
	}
	u := User{ID: newID(), Username: username, DisplayName: displayName, Role: "member"}
	if _, err := tx.Exec(ctx, `insert into users (id, role, username, display_name, password_hash) values ($1, 'member', $2, $3, $4)`,
		u.ID, u.Username, u.DisplayName, passwordHash); err != nil {
		var pe *pgconn.PgError
		if errors.As(err, &pe) && pe.Code == "23505" {
			return nil, ErrUsernameTaken
		}
		return nil, err
	}
	if _, err := tx.Exec(ctx, `update invites set status = 'accepted', responded_at = now(), user_id = $2 where id = $1`, inviteID, u.ID); err != nil {
		return nil, err
	}
	return &u, tx.Commit(ctx)
}

func (s *Store) CreatePasswordReset(ctx context.Context, userID uuid.UUID, tokenHash []byte, ttl time.Duration) error {
	_, err := s.pool.Exec(ctx, `insert into password_resets (id, user_id, token_hash, expires_at) values ($1, $2, $3, now() + $4::interval)`,
		newID(), userID, tokenHash, ttl.String())
	return err
}

func (s *Store) PasswordReset(ctx context.Context, tokenHash []byte) (*User, error) {
	var u User
	err := s.pool.QueryRow(ctx, `select u.id, u.username, u.display_name, u.role from password_resets r join users u on u.id = r.user_id
		where r.token_hash = $1 and r.used_at is null and r.expires_at > now()`, tokenHash).Scan(&u.ID, &u.Username, &u.DisplayName, &u.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &u, err
}

func (s *Store) UsePasswordReset(ctx context.Context, tokenHash []byte, passwordHash string) (*User, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var u User
	err = tx.QueryRow(ctx, `update password_resets r set used_at = now() from users u
		where r.token_hash = $1 and r.used_at is null and r.expires_at > now() and u.id = r.user_id
		returning u.id, u.username, u.display_name, u.role`, tokenHash).Scan(&u.ID, &u.Username, &u.DisplayName, &u.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `update users set password_hash = $2, updated_at = now() where id = $1`, u.ID, passwordHash); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `delete from sessions where user_id = $1`, u.ID); err != nil {
		return nil, err
	}
	return &u, tx.Commit(ctx)
}

func (s *Store) Audit(ctx context.Context, actor *uuid.UUID, action, subject string, detail any) {
	var raw []byte
	if detail != nil {
		raw, _ = json.Marshal(detail)
	}
	_, _ = s.pool.Exec(ctx, `insert into audit_log (id, actor_id, action, subject, detail) values ($1, $2, $3, $4, $5)`,
		newID(), actor, action, subject, raw)
}

func (s *Store) TouchLastSeen(ctx context.Context, userID uuid.UUID, at time.Time) error {
	_, err := s.pool.Exec(ctx, `update users set last_seen_at = greatest(coalesce(last_seen_at, $2), $2) where id = $1`, userID, at)
	return err
}

func (s *Store) LastSeen(ctx context.Context) (map[uuid.UUID]*time.Time, error) {
	rows, err := s.pool.Query(ctx, `select id, last_seen_at from users`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[uuid.UUID]*time.Time{}
	for rows.Next() {
		var id uuid.UUID
		var t *time.Time
		if err := rows.Scan(&id, &t); err != nil {
			return nil, err
		}
		out[id] = t
	}
	return out, rows.Err()
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
