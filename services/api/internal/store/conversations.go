package store

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const (
	ConversationDirect = "direct"
	ConversationGroup  = "group"
)

const MaxGroupMembers = 32

type ConversationMember struct {
	ID          uuid.UUID       `json:"id"`
	Username    string          `json:"username"`
	DisplayName string          `json:"display_name"`
	Avatar      json.RawMessage `json:"avatar,omitempty"`
	Role        string          `json:"role"`
}

type Conversation struct {
	ID            uuid.UUID            `json:"id"`
	Kind          string               `json:"kind"`
	Partner       bool                 `json:"partner"`
	PairID        *uuid.UUID           `json:"-"`
	Title         string               `json:"title"`
	CreatedBy     *uuid.UUID           `json:"created_by"`
	CreatedAt     time.Time            `json:"created_at"`
	LastMessageAt *time.Time           `json:"last_message_at"`
	Members       []ConversationMember `json:"members"`
	Accepted      bool                 `json:"accepted"`
	Role          string               `json:"role"`
	Unread        int                  `json:"unread"`
	Last          *ChatMessage         `json:"last,omitempty"`
}

func (c *Conversation) MemberIDs() []uuid.UUID {
	out := make([]uuid.UUID, len(c.Members))
	for i, m := range c.Members {
		out[i] = m.ID
	}
	return out
}

func (c *Conversation) Has(id uuid.UUID) bool {
	for _, m := range c.Members {
		if m.ID == id {
			return true
		}
	}
	return false
}

const conversationCols = `c.id, c.kind, c.pair_id, c.title, c.created_by, c.created_at, c.last_message_at, cm.accepted, cm.role,
	(select count(*) from chat_messages m where m.conversation_id = c.id and m.sender_id <> $1 and m.deleted_at is null and
		m.created_at > coalesce((select x.created_at from chat_reads r join chat_messages x on x.id = r.message_id
			where r.conversation_id = c.id and r.user_id = $1), '-infinity')),
	(select m.id from chat_messages m where m.conversation_id = c.id order by m.created_at desc, m.id desc limit 1)`

const conversationJoin = `from conversations c
	join conversation_members cm on cm.conversation_id = c.id and cm.user_id = $1
	left join pairs p on p.id = c.pair_id
	where (c.pair_id is null or p.ended_at is null)`

func (s *Store) scanConversations(ctx context.Context, me uuid.UUID, rows pgx.Rows) ([]Conversation, error) {
	defer rows.Close()
	out := []Conversation{}
	lastIDs := map[uuid.UUID]int{}
	for rows.Next() {
		var c Conversation
		var last *uuid.UUID
		if err := rows.Scan(&c.ID, &c.Kind, &c.PairID, &c.Title, &c.CreatedBy, &c.CreatedAt, &c.LastMessageAt, &c.Accepted, &c.Role,
			&c.Unread, &last); err != nil {
			return nil, err
		}
		c.Partner = c.PairID != nil
		if last != nil {
			lastIDs[*last] = len(out)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return out, nil
	}
	ids := make([]uuid.UUID, len(out))
	index := map[uuid.UUID]int{}
	for i, c := range out {
		ids[i] = c.ID
		index[c.ID] = i
	}
	mrows, err := s.pool.Query(ctx, `select cm.conversation_id, u.id, u.username, u.display_name, u.avatar, cm.role
		from conversation_members cm join users u on u.id = cm.user_id
		where cm.conversation_id = any($1) order by cm.joined_at, u.display_name`, ids)
	if err != nil {
		return nil, err
	}
	defer mrows.Close()
	for mrows.Next() {
		var conv uuid.UUID
		var m ConversationMember
		var avatar []byte
		if err := mrows.Scan(&conv, &m.ID, &m.Username, &m.DisplayName, &avatar, &m.Role); err != nil {
			return nil, err
		}
		if len(avatar) > 0 {
			m.Avatar = avatar
		}
		out[index[conv]].Members = append(out[index[conv]].Members, m)
	}
	if err := mrows.Err(); err != nil {
		return nil, err
	}
	if len(lastIDs) > 0 {
		msgIDs := make([]uuid.UUID, 0, len(lastIDs))
		for id := range lastIDs {
			msgIDs = append(msgIDs, id)
		}
		msgs, err := s.chatList(ctx, `select `+chatCols+` from chat_messages m where m.id = any($1)`, msgIDs)
		if err != nil {
			return nil, err
		}
		for i := range msgs {
			m := msgs[i]
			out[lastIDs[m.ID]].Last = &m
		}
	}
	return out, nil
}

func (s *Store) Conversations(ctx context.Context, me uuid.UUID) ([]Conversation, error) {
	rows, err := s.pool.Query(ctx, `select `+conversationCols+` `+conversationJoin+`
		order by (c.pair_id is not null) desc, coalesce(c.last_message_at, c.created_at) desc limit 200`, me)
	if err != nil {
		return nil, err
	}
	return s.scanConversations(ctx, me, rows)
}

func (s *Store) Conversation(ctx context.Context, me, id uuid.UUID) (*Conversation, error) {
	rows, err := s.pool.Query(ctx, `select `+conversationCols+` `+conversationJoin+` and c.id = $2`, me, id)
	if err != nil {
		return nil, err
	}
	list, err := s.scanConversations(ctx, me, rows)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, ErrNotFound
	}
	return &list[0], nil
}

func (s *Store) ConversationMemberIDs(ctx context.Context, id uuid.UUID) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `select cm.user_id from conversation_members cm join conversations c on c.id = cm.conversation_id
		left join pairs p on p.id = c.pair_id where cm.conversation_id = $1 and (c.pair_id is null or p.ended_at is null)`, id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
}

func (s *Store) PairConversation(ctx context.Context, pairID uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `select id from conversations where pair_id = $1`, pairID).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)
	if id, err = ensurePairConversation(ctx, tx, pairID); err != nil {
		return uuid.Nil, err
	}
	return id, tx.Commit(ctx)
}

func ensurePairConversation(ctx context.Context, tx pgx.Tx, pairID uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := tx.QueryRow(ctx, `insert into conversations (id, kind, pair_id) values ($1, 'direct', $2)
		on conflict (pair_id) do update set pair_id = excluded.pair_id returning id`, newID(), pairID).Scan(&id)
	if err != nil {
		return uuid.Nil, err
	}
	_, err = tx.Exec(ctx, `insert into conversation_members (conversation_id, user_id)
		select $1, user_id from pair_members where pair_id = $2 on conflict do nothing`, id, pairID)
	return id, err
}

func DirectKey(a, b uuid.UUID) string {
	ids := []string{a.String(), b.String()}
	sort.Strings(ids)
	return strings.Join(ids, ":")
}

func (s *Store) DirectConversation(ctx context.Context, me, other uuid.UUID, accepted bool) (uuid.UUID, bool, error) {
	if me == other {
		return uuid.Nil, false, ErrSelfFollow
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, false, err
	}
	defer tx.Rollback(ctx)
	key := DirectKey(me, other)
	var id uuid.UUID
	created := false
	err = tx.QueryRow(ctx, `select id from conversations where direct_key = $1`, key).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		id, created = newID(), true
		if _, err = tx.Exec(ctx, `insert into conversations (id, kind, direct_key, created_by) values ($1, 'direct', $2, $3)`, id, key, me); err != nil {
			return uuid.Nil, false, err
		}
	} else if err != nil {
		return uuid.Nil, false, err
	}
	if _, err := tx.Exec(ctx, `insert into conversation_members (conversation_id, user_id, accepted) values ($1, $2, true), ($1, $3, $4)
		on conflict (conversation_id, user_id) do update set accepted = conversation_members.accepted or excluded.accepted`,
		id, me, other, accepted); err != nil {
		return uuid.Nil, false, err
	}
	return id, created, tx.Commit(ctx)
}

func (s *Store) CreateGroup(ctx context.Context, me uuid.UUID, title string, members []uuid.UUID) (uuid.UUID, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)
	id := newID()
	if _, err := tx.Exec(ctx, `insert into conversations (id, kind, title, created_by) values ($1, 'group', $2, $3)`, id, title, me); err != nil {
		return uuid.Nil, err
	}
	if _, err := tx.Exec(ctx, `insert into conversation_members (conversation_id, user_id, role) values ($1, $2, 'owner')`, id, me); err != nil {
		return uuid.Nil, err
	}
	if _, err := tx.Exec(ctx, `insert into conversation_members (conversation_id, user_id)
		select $1, u from unnest($2::uuid[]) u where u <> $3 on conflict do nothing`, id, members, me); err != nil {
		return uuid.Nil, err
	}
	return id, tx.Commit(ctx)
}

func (s *Store) RenameConversation(ctx context.Context, id uuid.UUID, title string) error {
	tag, err := s.pool.Exec(ctx, `update conversations set title = $2 where id = $1 and kind = 'group'`, id, title)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) AddConversationMembers(ctx context.Context, id uuid.UUID, users []uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `insert into conversation_members (conversation_id, user_id)
		select c.id, u from conversations c, unnest($2::uuid[]) u where c.id = $1 and c.kind = 'group' on conflict do nothing`, id, users)
	return err
}

func (s *Store) RemoveConversationMember(ctx context.Context, id, user uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `delete from conversation_members cm using conversations c
		where c.id = cm.conversation_id and c.kind = 'group' and cm.conversation_id = $1 and cm.user_id = $2`, id, user)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	if _, err := tx.Exec(ctx, `update conversation_members set role = 'owner' where conversation_id = $1 and user_id = (
			select user_id from conversation_members where conversation_id = $1 order by joined_at limit 1)
		and not exists (select 1 from conversation_members where conversation_id = $1 and role = 'owner')`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `delete from conversations c where c.id = $1
		and not exists (select 1 from conversation_members where conversation_id = $1)`, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) AcceptConversation(ctx context.Context, id, me uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `update conversation_members set accepted = true where conversation_id = $1 and user_id = $2`, id, me)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) DeleteDirectConversation(ctx context.Context, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `delete from conversations where id = $1 and kind = 'direct' and pair_id is null`, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

type convCtxKey struct{}

func WithConversation(ctx context.Context, id uuid.UUID) context.Context {
	return context.WithValue(ctx, convCtxKey{}, id)
}

func ConversationFrom(ctx context.Context) *uuid.UUID {
	if id, ok := ctx.Value(convCtxKey{}).(uuid.UUID); ok && id != uuid.Nil {
		return &id
	}
	return nil
}
