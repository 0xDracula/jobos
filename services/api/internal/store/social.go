package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *Store) AppSetting(ctx context.Context, key string) (json.RawMessage, error) {
	var v []byte
	var err error
	if isPairSetting(key) {
		pairID, ok := PairFrom(ctx)
		if !ok {
			return nil, nil
		}
		err = s.pool.QueryRow(ctx, `select value from pair_settings where pair_id = $1 and key = $2`, pairID, key).Scan(&v)
	} else {
		err = s.pool.QueryRow(ctx, `select value from app_settings where key = $1`, key).Scan(&v)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return v, err
}

var ErrNotLinked = errors.New("not linked")

func (s *Store) SetAppSetting(ctx context.Context, key string, value json.RawMessage) error {
	if !settingKeyRE.MatchString(key) || len(value) == 0 || len(value) > 64<<10 || !json.Valid(value) {
		return errors.New("invalid app setting")
	}
	if isPairSetting(key) {
		pairID, ok := PairFrom(ctx)
		if !ok {
			return ErrNotLinked
		}
		_, err := s.pool.Exec(ctx, `insert into pair_settings (pair_id, key, value, updated_at) values ($1, $2, $3, now())
			on conflict (pair_id, key) do update set value = excluded.value, updated_at = now()`, pairID, key, []byte(value))
		return err
	}
	_, err := s.pool.Exec(ctx, `insert into app_settings (key, value, updated_at) values ($1, $2, now())
		on conflict (key) do update set value = excluded.value, updated_at = now()`, key, []byte(value))
	return err
}

func (s *Store) UserSetting(ctx context.Context, userID uuid.UUID, key string) (json.RawMessage, error) {
	var v []byte
	err := s.pool.QueryRow(ctx, `select value from user_settings where user_id = $1 and key = $2`, userID, key).Scan(&v)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return v, err
}

type ChatMessage struct {
	ID             uuid.UUID       `json:"id"`
	ConversationID uuid.UUID       `json:"conversation_id"`
	SenderID       uuid.UUID       `json:"sender_id"`
	ClientKey      string          `json:"client_key"`
	Kind           string          `json:"kind"`
	Body           string          `json:"body"`
	Data           json.RawMessage `json:"data,omitempty"`
	ReplyTo        *uuid.UUID      `json:"reply_to"`
	CreatedAt      time.Time       `json:"created_at"`
	EditedAt       *time.Time      `json:"edited_at"`
	Deleted        bool            `json:"deleted"`
	Reactions      []Reaction      `json:"reactions"`
	PinnedAt       *time.Time      `json:"pinned_at"`
	PinnedBy       *uuid.UUID      `json:"pinned_by"`
}

type Reaction struct {
	UserID uuid.UUID `json:"user_id"`
	Emoji  string    `json:"emoji"`
}

type ChatInput struct {
	ConversationID uuid.UUID
	ClientKey      string
	Kind           string
	Body           string
	Data           json.RawMessage
	ReplyTo        *uuid.UUID
}

const chatCols = `m.id, m.sender_id, m.client_key, m.kind, case when m.deleted_at is null then m.body else '' end,
	case when m.deleted_at is null then m.data end, m.reply_to, m.created_at, m.edited_at, m.deleted_at is not null,
	coalesce((select json_agg(json_build_object('user_id', r.user_id, 'emoji', r.emoji) order by r.created_at)
		from chat_reactions r where r.message_id = m.id), '[]'), m.pinned_at, m.pinned_by, m.conversation_id`

func scanChat(row pgx.Row) (*ChatMessage, error) {
	var m ChatMessage
	var data, reactions []byte
	err := row.Scan(&m.ID, &m.SenderID, &m.ClientKey, &m.Kind, &m.Body, &data, &m.ReplyTo, &m.CreatedAt, &m.EditedAt, &m.Deleted, &reactions, &m.PinnedAt, &m.PinnedBy, &m.ConversationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if len(data) > 0 {
		m.Data = data
	}
	m.Reactions = []Reaction{}
	_ = json.Unmarshal(reactions, &m.Reactions)
	return &m, nil
}

func (s *Store) SendChat(ctx context.Context, sender uuid.UUID, in ChatInput) (*ChatMessage, bool, error) {
	if in.ConversationID == uuid.Nil {
		return nil, false, ErrNotFound
	}
	var data any
	if len(in.Data) > 0 {
		data = []byte(in.Data)
	}
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `insert into chat_messages (id, conversation_id, sender_id, client_key, kind, body, data, reply_to,
			pair_id)
		values ($1, $2, $3, $4, $5, $6, $7, $8, (select pair_id from conversations where id = $2))
		on conflict (sender_id, client_key) do nothing returning id`,
		newID(), in.ConversationID, sender, in.ClientKey, in.Kind, in.Body, data, in.ReplyTo).Scan(&id)
	if err == nil {
		_, err = s.pool.Exec(ctx, `update conversations set last_message_at = now() where id = $1`, in.ConversationID)
		if err == nil {
			_, err = s.pool.Exec(ctx, `update conversation_members set accepted = true where conversation_id = $1 and user_id = $2 and not accepted`,
				in.ConversationID, sender)
		}
	}
	created := true
	if errors.Is(err, pgx.ErrNoRows) {
		created = false
		err = s.pool.QueryRow(ctx, `select id from chat_messages where sender_id = $1 and client_key = $2`, sender, in.ClientKey).Scan(&id)
	}
	if err != nil {
		return nil, false, err
	}
	m, err := s.ChatMessage(ctx, id)
	return m, created, err
}

func (s *Store) ChatMessage(ctx context.Context, id uuid.UUID) (*ChatMessage, error) {
	return scanChat(s.pool.QueryRow(ctx, `select `+chatCols+` from chat_messages m where m.id = $1`, id))
}

func (s *Store) ChatPage(ctx context.Context, conv uuid.UUID, before, after *uuid.UUID, limit int) ([]ChatMessage, error) {
	var rows pgx.Rows
	var err error
	switch {
	case after != nil:
		rows, err = s.pool.Query(ctx, `select `+chatCols+` from chat_messages m
			where m.conversation_id = $3 and (m.created_at > (select created_at from chat_messages where id = $1) or
				(m.created_at = (select created_at from chat_messages where id = $1) and m.id > $1))
			order by m.created_at, m.id limit $2`, *after, limit, conv)
	case before != nil:
		rows, err = s.pool.Query(ctx, `select * from (select `+chatCols+` from chat_messages m
			where m.conversation_id = $3 and (m.created_at, m.id) < ((select created_at from chat_messages where id = $1), $1)
			order by m.created_at desc, m.id desc limit $2) p order by 8, 1`, *before, limit, conv)
	default:
		rows, err = s.pool.Query(ctx, `select * from (select `+chatCols+` from chat_messages m where m.conversation_id = $2
			order by m.created_at desc, m.id desc limit $1) p order by 8, 1`, limit, conv)
	}
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

func (s *Store) EditChat(ctx context.Context, sender, id uuid.UUID, body string) (*ChatMessage, error) {
	tag, err := s.pool.Exec(ctx, `update chat_messages set body = $3, edited_at = now() where id = $1 and sender_id = $2 and deleted_at is null and kind = 'text'`, id, sender, body)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return s.ChatMessage(ctx, id)
}

func (s *Store) DeleteChat(ctx context.Context, sender, id uuid.UUID) (*ChatMessage, error) {
	tag, err := s.pool.Exec(ctx, `update chat_messages set deleted_at = now() where id = $1 and sender_id = $2 and deleted_at is null`, id, sender)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	_, _ = s.pool.Exec(ctx, `delete from chat_reactions where message_id = $1`, id)
	_, _ = s.pool.Exec(ctx, `update chat_messages set pinned_at = null, pinned_by = null where id = $1`, id)
	return s.ChatMessage(ctx, id)
}

func (s *Store) ReactChat(ctx context.Context, userID, id uuid.UUID, emoji string) (*ChatMessage, error) {
	var err error
	if emoji == "" {
		_, err = s.pool.Exec(ctx, `delete from chat_reactions where message_id = $1 and user_id = $2`, id, userID)
	} else {
		_, err = s.pool.Exec(ctx, `insert into chat_reactions (message_id, user_id, emoji, conversation_id)
			select $1, $2, $3, m.conversation_id from chat_messages m where m.id = $1 and m.deleted_at is null
			on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now()`, id, userID, emoji)
	}
	if err != nil {
		return nil, err
	}
	return s.ChatMessage(ctx, id)
}

func (s *Store) ReadChat(ctx context.Context, userID, conv, id uuid.UUID) (time.Time, error) {
	var at time.Time
	err := s.pool.QueryRow(ctx, `insert into chat_reads (conversation_id, user_id, message_id, read_at)
		select $3, $1, $2, now() where exists (select 1 from chat_messages where id = $2 and conversation_id = $3)
		on conflict (conversation_id, user_id) do update set message_id = excluded.message_id, read_at = now()
		where chat_reads.message_id is null or
			(select created_at from chat_messages where id = excluded.message_id) >= (select created_at from chat_messages where id = chat_reads.message_id)
		returning read_at`, userID, id, conv).Scan(&at)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Now(), nil
	}
	return at, err
}

type ChatRead struct {
	UserID    uuid.UUID  `json:"user_id"`
	MessageID *uuid.UUID `json:"message_id"`
	ReadAt    time.Time  `json:"read_at"`
}

func (s *Store) ChatReads(ctx context.Context, conv uuid.UUID) ([]ChatRead, error) {
	rows, err := s.pool.Query(ctx, `select user_id, message_id, read_at from chat_reads where conversation_id = $1`, conv)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ChatRead{}
	for rows.Next() {
		var r ChatRead
		if err := rows.Scan(&r.UserID, &r.MessageID, &r.ReadAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) UnreadCount(ctx context.Context, userID uuid.UUID) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `select count(*) from conversation_members cm
		join chat_messages m on m.conversation_id = cm.conversation_id
		where cm.user_id = $1 and cm.accepted and m.sender_id <> $1 and m.deleted_at is null and
			m.created_at > coalesce((select c.created_at from chat_reads r join chat_messages c on c.id = r.message_id
				where r.conversation_id = cm.conversation_id and r.user_id = $1), '-infinity')`, userID).Scan(&n)
	return n, err
}

type Lamp struct {
	From    uuid.UUID `json:"from"`
	To      uuid.UUID `json:"to"`
	OnUntil time.Time `json:"on_until"`
	SentAt  time.Time `json:"sent_at"`
}

func (s *Store) SendLamp(ctx context.Context, from, to uuid.UUID, until time.Time) (*Lamp, error) {
	l := Lamp{From: from, To: to, OnUntil: until}
	err := s.pool.QueryRow(ctx, `insert into signals (id, from_user, to_user, kind, on_until) values ($1, $2, $3, 'lamp', $4) returning created_at`,
		newID(), from, to, until).Scan(&l.SentAt)
	return &l, err
}

func (s *Store) LampOff(ctx context.Context, from, to uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `update signals set on_until = null where from_user = $1 and to_user = $2 and kind = 'lamp' and on_until > now()`, from, to)
	return err
}

func (s *Store) Lamps(ctx context.Context) ([]Lamp, error) {
	rows, err := s.pool.Query(ctx, `select distinct on (from_user, to_user) from_user, to_user, on_until, created_at from signals
		where kind = 'lamp' and on_until > now() order by from_user, to_user, created_at desc`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Lamp{}
	for rows.Next() {
		var l Lamp
		if err := rows.Scan(&l.From, &l.To, &l.OnUntil, &l.SentAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (s *Store) LastSignal(ctx context.Context, from uuid.UUID, kind string) (*time.Time, error) {
	var t *time.Time
	err := s.pool.QueryRow(ctx, `select max(created_at) from signals where from_user = $1 and kind = $2`, from, kind).Scan(&t)
	return t, err
}

type PushSubscription struct {
	ID       uuid.UUID
	UserID   uuid.UUID
	Endpoint string
	P256dh   string
	Auth     string
}

func (s *Store) SavePushSubscription(ctx context.Context, userID uuid.UUID, endpoint, p256dh, auth, userAgent string) error {
	_, err := s.pool.Exec(ctx, `insert into push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent) values ($1, $2, $3, $4, $5, nullif($6, ''))
		on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent`,
		newID(), userID, endpoint, p256dh, auth, truncate(userAgent, 300))
	return err
}

func (s *Store) DeletePushSubscription(ctx context.Context, endpoint string) error {
	_, err := s.pool.Exec(ctx, `delete from push_subscriptions where endpoint = $1`, endpoint)
	return err
}

func (s *Store) PushSubscriptions(ctx context.Context, userID uuid.UUID) ([]PushSubscription, error) {
	rows, err := s.pool.Query(ctx, `select id, user_id, endpoint, p256dh, auth from push_subscriptions where user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PushSubscription
	for rows.Next() {
		var p PushSubscription
		if err := rows.Scan(&p.ID, &p.UserID, &p.Endpoint, &p.P256dh, &p.Auth); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) TouchPushSubscription(ctx context.Context, id uuid.UUID) {
	_, _ = s.pool.Exec(ctx, `update push_subscriptions set last_used_at = now() where id = $1`, id)
}

type Swap struct {
	Week      string     `json:"week"`
	UserID    uuid.UUID  `json:"user_id"`
	Track     *TrackView `json:"track"`
	Note      string     `json:"note"`
	UpdatedAt time.Time  `json:"updated_at"`
	Reaction  string     `json:"reaction"`
}

func (s *Store) SetSwap(ctx context.Context, week time.Time, userID, trackID uuid.UUID, note string) error {
	_, err := s.pool.Exec(ctx, `insert into song_swaps (id, week, user_id, track_id, note) values ($1, $2, $3, $4, $5)
		on conflict (pair_id, week, user_id) do update set track_id = excluded.track_id, note = excluded.note, updated_at = now()`,
		newID(), week, userID, trackID, note)
	return err
}

func (s *Store) Swaps(ctx context.Context, from, to time.Time) ([]Swap, error) {
	rows, err := s.pool.Query(ctx, `select to_char(week, 'YYYY-MM-DD'), user_id, track_id, note, updated_at, reaction from song_swaps
		where week between $1 and $2 order by week desc, created_at`, from, to)
	if err != nil {
		return nil, err
	}
	type row struct {
		Swap
		trackID uuid.UUID
	}
	var raw []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.Week, &r.UserID, &r.trackID, &r.Note, &r.UpdatedAt, &r.Reaction); err != nil {
			rows.Close()
			return nil, err
		}
		raw = append(raw, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	ids := make([]uuid.UUID, 0, len(raw))
	for _, r := range raw {
		ids = append(ids, r.trackID)
	}
	tracks, err := s.TracksByID(ctx, ids)
	if err != nil {
		return nil, err
	}
	byID := map[uuid.UUID]*TrackView{}
	for i := range tracks {
		byID[tracks[i].ID] = &tracks[i]
	}
	out := make([]Swap, 0, len(raw))
	for _, r := range raw {
		r.Swap.Track = byID[r.trackID]
		out = append(out, r.Swap)
	}
	return out, nil
}

type SharedSong struct {
	TrackID uuid.UUID `json:"track_id"`
	Kind    string    `json:"kind"`
	By      uuid.UUID `json:"by"`
	At      time.Time `json:"at"`
	Note    string    `json:"note"`
}
