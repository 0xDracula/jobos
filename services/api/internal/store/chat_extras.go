package store

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *Store) PinChat(ctx context.Context, userID, id uuid.UUID, on bool) (*ChatMessage, error) {
	q := `update chat_messages set pinned_at = null, pinned_by = null where id = $1 and deleted_at is null and $2::uuid is not null`
	if on {
		q = `update chat_messages set pinned_at = now(), pinned_by = $2 where id = $1 and deleted_at is null`
	}
	tag, err := s.pool.Exec(ctx, q, id, userID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return s.ChatMessage(ctx, id)
}

func (s *Store) ChatPins(ctx context.Context, conv uuid.UUID) ([]ChatMessage, error) {
	return s.chatList(ctx, `select `+chatCols+` from chat_messages m where m.conversation_id = $1 and m.pinned_at is not null
		and m.deleted_at is null order by m.pinned_at desc limit 100`, conv)
}

func (s *Store) ChatAround(ctx context.Context, conv, id uuid.UUID, limit int) ([]ChatMessage, error) {
	half := limit / 2
	return s.chatList(ctx, `select * from (
			(select `+chatCols+` from chat_messages m
				where m.conversation_id = $4 and (m.created_at, m.id) < ((select created_at from chat_messages where id = $1), $1)
				order by m.created_at desc, m.id desc limit $2)
			union all
			(select `+chatCols+` from chat_messages m
				where m.conversation_id = $4 and (m.created_at, m.id) >= ((select created_at from chat_messages where id = $1), $1)
				order by m.created_at, m.id limit $3)
		) p order by 8, 1`, id, half, limit-half, conv)
}

const chatSearchText = `chat_fold(m.body || ' ' || coalesce(m.data->'track'->>'title', '') || ' ' ||
	coalesce(m.data->'track'->>'artists', '') || ' ' || coalesce(m.data->>'note', '') || ' ' ||
	coalesce(case when jsonb_typeof(m.data->'lines') = 'array'
		then (select string_agg(x->>'text', ' ') from jsonb_array_elements(m.data->'lines') x) end, ''))`

func SearchTerms(q string) []string {
	var out []string
	for _, w := range strings.Fields(q) {
		if len(out) == 5 {
			break
		}
		w = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(w)
		out = append(out, w)
	}
	return out
}

func (s *Store) SearchChat(ctx context.Context, conv uuid.UUID, q string, limit int) ([]ChatMessage, error) {
	terms := SearchTerms(q)
	if len(terms) == 0 {
		return []ChatMessage{}, nil
	}
	return s.chatList(ctx, `select `+chatCols+` from chat_messages m
		where m.conversation_id = $3 and m.deleted_at is null and not exists (
			select 1 from unnest($1::text[]) t where `+chatSearchText+` not like '%' || chat_fold(t) || '%' escape '\')
		order by m.created_at desc, m.id desc limit $2`, terms, limit, conv)
}

func (s *Store) chatList(ctx context.Context, q string, args ...any) ([]ChatMessage, error) {
	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ChatMessage{}
	for rows.Next() {
		m, err := scanChat(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

type ChatSticker struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Mime      string    `json:"mime"`
	Path      string    `json:"-"`
	Position  int       `json:"position"`
	CreatedAt time.Time `json:"created_at"`
}

func (s *Store) ChatStickers(ctx context.Context) ([]ChatSticker, error) {
	rows, err := s.pool.Query(ctx, `select id, name, mime, path, position, created_at from chat_stickers order by position, created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ChatSticker{}
	for rows.Next() {
		var c ChatSticker
		if err := rows.Scan(&c.ID, &c.Name, &c.Mime, &c.Path, &c.Position, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) ChatSticker(ctx context.Context, id uuid.UUID) (*ChatSticker, error) {
	var c ChatSticker
	err := s.pool.QueryRow(ctx, `select id, name, mime, path, position, created_at from chat_stickers where id = $1`, id).
		Scan(&c.ID, &c.Name, &c.Mime, &c.Path, &c.Position, &c.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &c, err
}

func (s *Store) CreateChatSticker(ctx context.Context, by uuid.UUID, name, path, mime string) (*ChatSticker, error) {
	id := newID()
	if _, err := s.pool.Exec(ctx, `insert into chat_stickers (id, name, path, mime, position, created_by)
		values ($1, $2, $3, $4, coalesce((select max(position) + 1 from chat_stickers), 0), $5)`, id, name, path, mime, by); err != nil {
		return nil, err
	}
	return s.ChatSticker(ctx, id)
}

func (s *Store) DeleteChatSticker(ctx context.Context, id uuid.UUID) (string, error) {
	var path string
	err := s.pool.QueryRow(ctx, `delete from chat_stickers where id = $1 returning path`, id).Scan(&path)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return path, err
}

func (s *Store) ReactSwap(ctx context.Context, week time.Time, pickBy uuid.UUID, emoji string) error {
	tag, err := s.pool.Exec(ctx, `update song_swaps set reaction = $3, reaction_at = case when $3 = '' then null else now() end
		where week = $1 and user_id = $2`, week, pickBy, emoji)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
