package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	PairPartner = "partner"
	PairFriend  = "friend"
)

type Pair struct {
	ID        uuid.UUID  `json:"id"`
	Kind      string     `json:"kind"`
	CreatedAt time.Time  `json:"created_at"`
	EndedAt   *time.Time `json:"ended_at,omitempty"`
	Members   []User     `json:"members"`
}

func (p *Pair) Other(me uuid.UUID) *User {
	if p == nil {
		return nil
	}
	for i := range p.Members {
		if p.Members[i].ID != me {
			return &p.Members[i]
		}
	}
	return nil
}

func ValidPairKind(kind string) bool { return kind == PairPartner || kind == PairFriend }

type pairCtxKey struct{}

type pairScope struct {
	id   uuid.UUID
	user uuid.UUID
	any  bool
}

func WithPair(ctx context.Context, id uuid.UUID) context.Context {
	return context.WithValue(ctx, pairCtxKey{}, pairScope{id: id})
}

func WithScope(ctx context.Context, pairID, userID uuid.UUID) context.Context {
	return context.WithValue(ctx, pairCtxKey{}, pairScope{id: pairID, user: userID})
}

func AnyPair(ctx context.Context) context.Context {
	return context.WithValue(ctx, pairCtxKey{}, pairScope{any: true})
}

func PairFrom(ctx context.Context) (uuid.UUID, bool) {
	s, ok := ctx.Value(pairCtxKey{}).(pairScope)
	if !ok || s.any || s.id == uuid.Nil {
		return uuid.Nil, false
	}
	return s.id, true
}

func Scoped(ctx context.Context) bool {
	s, ok := ctx.Value(pairCtxKey{}).(pairScope)
	return ok && !s.any
}

func pairSetting(ctx context.Context) string {
	s, ok := ctx.Value(pairCtxKey{}).(pairScope)
	switch {
	case !ok || s.any:
		return "any"
	case s.id == uuid.Nil:
		return "none"
	default:
		return s.id.String()
	}
}

func userSetting(ctx context.Context) string {
	if s, ok := ctx.Value(pairCtxKey{}).(pairScope); ok && !s.any && s.user != uuid.Nil {
		return s.user.String()
	}
	return ""
}

const AppRole = "jobbos_app"

func ConfigurePool(cfg *pgxpool.Config) {
	var mu sync.Mutex
	current := map[*pgx.Conn]string{}
	after := cfg.AfterConnect
	cfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		if after != nil {
			if err := after(ctx, conn); err != nil {
				return err
			}
		}
		_, err := conn.Exec(ctx, "set role "+AppRole)
		return err
	}
	cfg.PrepareConn = func(ctx context.Context, conn *pgx.Conn) (bool, error) {
		pair, user := pairSetting(ctx), userSetting(ctx)
		want := pair + "|" + user
		mu.Lock()
		have := current[conn]
		mu.Unlock()
		if have == want {
			return true, nil
		}
		if _, err := conn.Exec(ctx, "select set_config('jobbos.pair', $1, false), set_config('jobbos.user', $2, false)", pair, user); err != nil {
			return false, fmt.Errorf("set jobbos.pair: %w", err)
		}
		mu.Lock()
		current[conn] = want
		mu.Unlock()
		return true, nil
	}
	cfg.BeforeClose = func(conn *pgx.Conn) {
		mu.Lock()
		delete(current, conn)
		mu.Unlock()
	}
}

func (s *Store) ActivePair(ctx context.Context, userID uuid.UUID) (*Pair, error) {
	var p Pair
	err := s.pool.QueryRow(ctx, `select p.id, p.kind, p.created_at from pairs p
		join pair_members m on m.pair_id = p.id
		where m.user_id = $1 and p.ended_at is null`, userID).Scan(&p.ID, &p.Kind, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	p.Members, err = s.pairMembers(ctx, p.ID)
	return &p, err
}

func (s *Store) pairMembers(ctx context.Context, pairID uuid.UUID) ([]User, error) {
	rows, err := s.pool.Query(ctx, `select u.id, u.username, u.display_name, u.role, u.avatar
		from pair_members m join users u on u.id = m.user_id where m.pair_id = $1 order by u.created_at`, pairID)
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

func (s *Store) ActivePairs(ctx context.Context) ([]Pair, error) {
	rows, err := s.pool.Query(ctx, `select id, kind, created_at from pairs where ended_at is null order by created_at`)
	if err != nil {
		return nil, err
	}
	var out []Pair
	for rows.Next() {
		var p Pair
		if err := rows.Scan(&p.ID, &p.Kind, &p.CreatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		if out[i].Members, err = s.pairMembers(ctx, out[i].ID); err != nil {
			return nil, err
		}
	}
	return out, nil
}

var ErrAlreadyLinked = errors.New("already linked")

var ErrSelfLink = errors.New("can't link an account to itself")

func (s *Store) LinkUsers(ctx context.Context, a, b uuid.UUID, kind string) (*Pair, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := linkTx(ctx, tx, a, b, kind); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.ActivePair(ctx, a)
}

func linkTx(ctx context.Context, tx pgx.Tx, a, b uuid.UUID, kind string) (uuid.UUID, error) {
	if a == b {
		return uuid.Nil, ErrSelfLink
	}
	if !ValidPairKind(kind) {
		return uuid.Nil, fmt.Errorf("unknown pair kind %q", kind)
	}
	if kind == PairFriend {
		_, err := tx.Exec(ctx, `insert into follows (follower_id, followee_id) values ($1, $2), ($2, $1)
			on conflict (follower_id, followee_id) do update set status = 'accepted'`, a, b)
		return uuid.Nil, err
	}
	if _, err := tx.Exec(ctx, `select id from users where id = any($1) order by id for update`, []uuid.UUID{a, b}); err != nil {
		return uuid.Nil, err
	}
	var busy bool
	if err := tx.QueryRow(ctx, `select exists (select 1 from pair_members m join pairs p on p.id = m.pair_id
		where m.user_id = any($1) and p.ended_at is null)`, []uuid.UUID{a, b}).Scan(&busy); err != nil {
		return uuid.Nil, err
	}
	if busy {
		return uuid.Nil, ErrAlreadyLinked
	}
	var id uuid.UUID
	err := tx.QueryRow(ctx, `select p.id from pairs p
		where (select count(*) from pair_members m where m.pair_id = p.id and m.user_id = any($1)) = 2
		order by p.created_at desc limit 1`, []uuid.UUID{a, b}).Scan(&id)
	switch {
	case err == nil:
		if _, err := tx.Exec(ctx, `update pairs set ended_at = null, ended_by = null, kind = $2 where id = $1`, id, kind); err != nil {
			return uuid.Nil, err
		}
	case errors.Is(err, pgx.ErrNoRows):
		id = newID()
		if _, err := tx.Exec(ctx, `insert into pairs (id, kind) values ($1, $2)`, id, kind); err != nil {
			return uuid.Nil, err
		}
		if _, err := tx.Exec(ctx, `insert into pair_members (pair_id, user_id) values ($1, $2), ($1, $3)`, id, a, b); err != nil {
			return uuid.Nil, err
		}
	default:
		return uuid.Nil, err
	}
	if _, err := ensurePairConversation(ctx, tx, id); err != nil {
		return uuid.Nil, err
	}
	_, err = tx.Exec(ctx, `insert into follows (follower_id, followee_id) values ($1, $2), ($2, $1)
		on conflict (follower_id, followee_id) do update set status = 'accepted'`, a, b)
	return id, err
}

func (s *Store) Unlink(ctx context.Context, userID uuid.UUID, keep bool) error {
	p, err := s.ActivePair(ctx, userID)
	if err != nil {
		return err
	}
	if p == nil {
		return ErrNotFound
	}
	if keep {
		_, err = s.pool.Exec(ctx, `update pairs set ended_at = now(), ended_by = $2 where id = $1`, p.ID, userID)
		return err
	}
	_, err = s.pool.Exec(ctx, `delete from pairs where id = $1`, p.ID)
	return err
}

func (s *Store) SetPairKind(ctx context.Context, pairID uuid.UUID, kind string) error {
	if !ValidPairKind(kind) {
		return fmt.Errorf("unknown pair kind %q", kind)
	}
	_, err := s.pool.Exec(ctx, `update pairs set kind = $2 where id = $1 and ended_at is null`, pairID, kind)
	return err
}

func isPairSetting(key string) bool {
	switch key {
	case "our_song", "milestones", "visibility", "gift.her_playlist", "dates.member_birthdays", "swaps.revealed":
		return true
	}
	return strings.HasPrefix(key, "placeholders.")
}

const pairSettingSQL = `select ps.value from pair_settings ps
	join pairs p on p.id = ps.pair_id and p.ended_at is null
	join pair_members m on m.pair_id = p.id
	where m.user_id = $1 and ps.key = $2`

const partnerNameSQL = `select u.display_name from pair_members m
	join pairs p on p.id = m.pair_id and p.ended_at is null
	join pair_members o on o.pair_id = m.pair_id and o.user_id <> m.user_id
	join users u on u.id = o.user_id
	where m.user_id = $1`
