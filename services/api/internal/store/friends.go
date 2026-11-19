package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const (
	AudienceFollowers = "followers"
	AudienceFriends   = "friends"
	AudiencePartner   = "partner"
	AudienceNone      = "none"
)

type Privacy struct {
	Private          bool       `json:"private"`
	Searchable       bool       `json:"searchable"`
	ActivityAudience string     `json:"activity_audience"`
	MessagesFrom     string     `json:"messages_from"`
	JamInvitesFrom   string     `json:"jam_invites_from"`
	PrivateUntil     *time.Time `json:"private_session_until"`
}

func (p Privacy) Validate() error {
	switch p.ActivityAudience {
	case AudienceFollowers, AudienceFriends, AudiencePartner, AudienceNone:
	default:
		return fmt.Errorf("activity_audience must be followers, friends, partner or none")
	}
	for _, v := range []string{p.MessagesFrom, p.JamInvitesFrom} {
		if v != "friends" && v != "everyone" {
			return fmt.Errorf("messages_from and jam_invites_from must be friends or everyone")
		}
	}
	return nil
}

func (p Privacy) PrivateSession(now time.Time) bool {
	return p.PrivateUntil != nil && p.PrivateUntil.After(now)
}

func (s *Store) Privacy(ctx context.Context, userID uuid.UUID) (*Privacy, error) {
	var p Privacy
	err := s.pool.QueryRow(ctx, `select private, searchable, activity_audience, messages_from, jam_invites_from, private_session_until
		from users where id = $1`, userID).Scan(&p.Private, &p.Searchable, &p.ActivityAudience, &p.MessagesFrom, &p.JamInvitesFrom, &p.PrivateUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &p, err
}

func (s *Store) SetPrivacy(ctx context.Context, userID uuid.UUID, p Privacy) error {
	if err := p.Validate(); err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `update users set private = $2, searchable = $3, activity_audience = $4, messages_from = $5,
		jam_invites_from = $6, private_session_until = $7, updated_at = now() where id = $1`,
		userID, p.Private, p.Searchable, p.ActivityAudience, p.MessagesFrom, p.JamInvitesFrom, p.PrivateUntil); err != nil {
		return err
	}
	if !p.Private {
		if _, err := tx.Exec(ctx, `update follows set status = 'accepted' where followee_id = $1 and status = 'requested'`, userID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

type Relation struct {
	Following    bool `json:"following"`
	Requested    bool `json:"requested"`
	FollowsYou   bool `json:"follows_you"`
	RequestedYou bool `json:"requested_you"`
	Friend       bool `json:"friend"`
	Partner      bool `json:"partner"`
	Self         bool `json:"self"`
}

type Person struct {
	ID          uuid.UUID       `json:"id"`
	Username    string          `json:"username"`
	DisplayName string          `json:"display_name"`
	Avatar      json.RawMessage `json:"avatar,omitempty"`
	Private     bool            `json:"private"`
	Relation    Relation        `json:"relation"`
	Note        string          `json:"note,omitempty"`

	ActivityAudience string     `json:"-"`
	PrivateUntil     *time.Time `json:"-"`
	JamInvitesFrom   string     `json:"-"`
	MessagesFrom     string     `json:"-"`
}

const partnersSQL = `exists (select 1 from pair_members a join pair_members b on b.pair_id = a.pair_id and b.user_id <> a.user_id
	join pairs p on p.id = a.pair_id and p.ended_at is null and p.kind = 'partner' where a.user_id = $1 and b.user_id = u.id)`

const personCols = `u.id, u.username, u.display_name, u.avatar, u.private,
	exists (select 1 from follows f where f.follower_id = $1 and f.followee_id = u.id and f.status = 'accepted'),
	exists (select 1 from follows f where f.follower_id = $1 and f.followee_id = u.id and f.status = 'requested'),
	exists (select 1 from follows f where f.follower_id = u.id and f.followee_id = $1 and f.status = 'accepted'),
	exists (select 1 from follows f where f.follower_id = u.id and f.followee_id = $1 and f.status = 'requested'),
	` + partnersSQL + `, u.activity_audience, u.private_session_until, u.jam_invites_from, u.messages_from`

func scanPerson(row pgx.Row, viewer uuid.UUID) (Person, error) {
	var p Person
	var avatar []byte
	r := &p.Relation
	err := row.Scan(&p.ID, &p.Username, &p.DisplayName, &avatar, &p.Private, &r.Following, &r.Requested, &r.FollowsYou, &r.RequestedYou,
		&r.Partner, &p.ActivityAudience, &p.PrivateUntil, &p.JamInvitesFrom, &p.MessagesFrom)
	if err != nil {
		return p, err
	}
	if len(avatar) > 0 {
		p.Avatar = avatar
	}
	r.Friend = r.Following && r.FollowsYou
	r.Self = p.ID == viewer
	return p, nil
}

func (s *Store) people(ctx context.Context, viewer uuid.UUID, suffix string, args ...any) ([]Person, error) {
	rows, err := s.pool.Query(ctx, `select `+personCols+` from users u `+suffix, append([]any{viewer}, args...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Person{}
	for rows.Next() {
		p, err := scanPerson(rows, viewer)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) PersonByID(ctx context.Context, viewer, id uuid.UUID) (*Person, error) {
	p, err := scanPerson(s.pool.QueryRow(ctx, `select `+personCols+` from users u where u.id = $2`, viewer, id), viewer)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &p, err
}

func (s *Store) PersonByUsername(ctx context.Context, viewer uuid.UUID, username string) (*Person, error) {
	p, err := scanPerson(s.pool.QueryRow(ctx, `select `+personCols+` from users u where lower(u.username) = lower($2)`, viewer, username), viewer)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &p, err
}

func (s *Store) PeopleByID(ctx context.Context, viewer uuid.UUID, ids []uuid.UUID) ([]Person, error) {
	return s.people(ctx, viewer, `where u.id = any($2)`, ids)
}

var ErrSelfFollow = errors.New("can't follow yourself")

func (s *Store) Follow(ctx context.Context, follower, followee uuid.UUID) (string, error) {
	if follower == followee {
		return "", ErrSelfFollow
	}
	var status string
	err := s.pool.QueryRow(ctx, `insert into follows (follower_id, followee_id, status)
		select $1, u.id, case when u.private then 'requested' else 'accepted' end from users u where u.id = $2
		on conflict (follower_id, followee_id) do update set status = follows.status
		returning status`, follower, followee).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return status, err
}

func (s *Store) Unfollow(ctx context.Context, follower, followee uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `delete from follows where follower_id = $1 and followee_id = $2`, follower, followee)
	return err
}

func (s *Store) RemoveFollower(ctx context.Context, me, follower uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `delete from follows where follower_id = $2 and followee_id = $1`, me, follower)
	return err
}

func (s *Store) AcceptFollower(ctx context.Context, me, follower uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `update follows set status = 'accepted' where followee_id = $1 and follower_id = $2 and status = 'requested'`, me, follower)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) FollowEachOther(ctx context.Context, a, b uuid.UUID) error {
	if a == b {
		return ErrSelfFollow
	}
	_, err := s.pool.Exec(ctx, `insert into follows (follower_id, followee_id) values ($1, $2), ($2, $1)
		on conflict (follower_id, followee_id) do update set status = 'accepted'`, a, b)
	return err
}

func (s *Store) FollowRequests(ctx context.Context, me uuid.UUID) ([]Person, error) {
	return s.people(ctx, me, `join follows f on f.follower_id = u.id and f.followee_id = $1 and f.status = 'requested'
		order by f.created_at desc`)
}

func (s *Store) Followers(ctx context.Context, viewer, subject uuid.UUID, limit int) ([]Person, error) {
	return s.people(ctx, viewer, `join follows f on f.follower_id = u.id and f.followee_id = $2 and f.status = 'accepted'
		order by (u.id = $1) desc, exists (select 1 from follows x where x.follower_id = $1 and x.followee_id = u.id) desc,
			f.created_at desc limit $3`, subject, limit)
}

func (s *Store) Following(ctx context.Context, viewer, subject uuid.UUID, limit int) ([]Person, error) {
	return s.people(ctx, viewer, `join follows f on f.followee_id = u.id and f.follower_id = $2 and f.status = 'accepted'
		order by (u.id = $1) desc, exists (select 1 from follows x where x.follower_id = $1 and x.followee_id = u.id) desc,
			f.created_at desc limit $3`, subject, limit)
}

const friendsSQL = `exists (select 1 from follows a where a.follower_id = $1 and a.followee_id = u.id and a.status = 'accepted')
	and exists (select 1 from follows b where b.follower_id = u.id and b.followee_id = $1 and b.status = 'accepted')`

func (s *Store) Friends(ctx context.Context, me uuid.UUID) ([]Person, error) {
	return s.people(ctx, me, `where `+friendsSQL+` order by `+partnersSQL+` desc, lower(u.display_name)`)
}

func (s *Store) AreFriends(ctx context.Context, a, b uuid.UUID) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `select exists (select 1 from users u where u.id = $2 and `+friendsSQL+`)`, a, b).Scan(&ok)
	return ok, err
}

func (s *Store) SearchPeople(ctx context.Context, viewer uuid.UUID, q string, limit int) ([]Person, error) {
	pattern := "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(strings.TrimSpace(q)) + "%"
	return s.people(ctx, viewer, `where u.id <> $1 and (u.display_name ilike $2 or u.username ilike $2)
		and (u.searchable or exists (select 1 from follows f where (f.follower_id = $1 and f.followee_id = u.id) or (f.follower_id = u.id and f.followee_id = $1)))
		order by `+friendsSQL+` desc, lower(u.display_name) limit $3`, pattern, limit)
}

func (s *Store) SuggestedPeople(ctx context.Context, viewer uuid.UUID, limit int) ([]Person, error) {
	rows, err := s.pool.Query(ctx, `with mine as (select u.id, u.display_name from users u where `+friendsSQL+`),
		theirs as (
			select f.followee_id as id, m.display_name as via from mine m
			join follows f on f.follower_id = m.id and f.status = 'accepted'
			join follows g on g.follower_id = f.followee_id and g.followee_id = m.id and g.status = 'accepted'
			where f.followee_id <> $1)
		select t.id, count(*), (array_agg(t.via order by t.via))[1:2] from theirs t
		join users u on u.id = t.id
		where u.searchable and not exists (select 1 from follows x where x.follower_id = $1 and x.followee_id = t.id)
		group by t.id order by count(*) desc, max(u.display_name) limit $2`, viewer, limit)
	if err != nil {
		return nil, err
	}
	type pick struct {
		id   uuid.UUID
		n    int
		vias []string
	}
	picks, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (pick, error) {
		var p pick
		return p, r.Scan(&p.id, &p.n, &p.vias)
	})
	if err != nil || len(picks) == 0 {
		return []Person{}, err
	}
	ids := make([]uuid.UUID, len(picks))
	for i, p := range picks {
		ids[i] = p.id
	}
	people, err := s.PeopleByID(ctx, viewer, ids)
	if err != nil {
		return nil, err
	}
	byID := map[uuid.UUID]Person{}
	for _, p := range people {
		byID[p.ID] = p
	}
	out := make([]Person, 0, len(picks))
	for _, pk := range picks {
		p, ok := byID[pk.id]
		if !ok {
			continue
		}
		p.Note = "Friends with " + strings.Join(pk.vias, " and ")
		if pk.n > len(pk.vias) {
			p.Note = fmt.Sprintf("Friends with %s and %d more", strings.Join(pk.vias, ", "), pk.n-len(pk.vias))
		}
		out = append(out, p)
	}
	return out, nil
}

func (s *Store) MutualFriends(ctx context.Context, viewer, subject uuid.UUID, limit int) ([]Person, error) {
	return s.people(ctx, viewer, `where `+friendsSQL+` and u.id <> $2
		and exists (select 1 from follows a where a.follower_id = $2 and a.followee_id = u.id and a.status = 'accepted')
		and exists (select 1 from follows b where b.follower_id = u.id and b.followee_id = $2 and b.status = 'accepted')
		order by lower(u.display_name) limit $3`, subject, limit)
}

type ProfileCounts struct {
	Followers int `json:"followers"`
	Following int `json:"following"`
	Friends   int `json:"friends"`
	Playlists int `json:"playlists"`
}

const visiblePlaylistSQL = `(p.owner_id = $1 or p.visibility = 'public'
	or (p.visibility in ('friends', 'partner') and exists (select 1 from users u where u.id = $2 and ` + partnersSQL + `))
	or (p.visibility = 'friends' and exists (select 1 from users u where u.id = $2 and ` + friendsSQL + `)))`

func (s *Store) ProfileCounts(ctx context.Context, viewer, subject uuid.UUID) (ProfileCounts, error) {
	var c ProfileCounts
	err := s.pool.QueryRow(ctx, `select
		(select count(*) from follows where followee_id = $2 and status = 'accepted'),
		(select count(*) from follows where follower_id = $2 and status = 'accepted'),
		(select count(*) from follows a join follows b on b.follower_id = a.followee_id and b.followee_id = a.follower_id and b.status = 'accepted'
			where a.follower_id = $2 and a.status = 'accepted'),
		(select count(*) from playlists p where p.owner_id = $2 and `+visiblePlaylistSQL+`)`, viewer, subject).
		Scan(&c.Followers, &c.Following, &c.Friends, &c.Playlists)
	return c, err
}

func (s *Store) ProfilePlaylists(ctx context.Context, viewer, subject uuid.UUID) ([]PlaylistSummary, error) {
	rows, err := s.pool.Query(ctx, playlistSummarySQL+` where p.owner_id = $2 and `+visiblePlaylistSQL+`
		group by p.id order by p.updated_at desc limit 50`, viewer, subject)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PlaylistSummary{}
	for rows.Next() {
		p, err := scanPlaylistSummary(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

type LastPlay struct {
	UserID  uuid.UUID `json:"user_id"`
	TrackID uuid.UUID `json:"track_id"`
	At      time.Time `json:"at"`
}

func (s *Store) LastPlays(ctx context.Context, users []uuid.UUID, since time.Time) (map[uuid.UUID]LastPlay, error) {
	rows, err := s.pool.Query(ctx, `select distinct on (e.user_id) e.user_id, e.track_id, e.created_at from listening_events e
		where e.user_id = any($1) and e.event = 'start' and e.created_at > $2 and coalesce((e.context ->> 'private')::boolean, false) = false
		order by e.user_id, e.created_at desc`, users, since)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (LastPlay, error) {
		var p LastPlay
		return p, r.Scan(&p.UserID, &p.TrackID, &p.At)
	})
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID]LastPlay, len(list))
	for _, p := range list {
		out[p.UserID] = p
	}
	return out, nil
}

const libraryPlaylistSQL = `(p.owner_id = $1 or p.recipient_id = $1
	or p.owner_id in (select b.user_id from pair_members a join pair_members b on b.pair_id = a.pair_id and b.user_id <> a.user_id
		join pairs x on x.id = a.pair_id and x.ended_at is null and x.kind = 'partner' where a.user_id = $1)
	or p.recipient_id in (select b.user_id from pair_members a join pair_members b on b.pair_id = a.pair_id and b.user_id <> a.user_id
		join pairs x on x.id = a.pair_id and x.ended_at is null and x.kind = 'partner' where a.user_id = $1)
	or (p.owner_id is null and p.recipient_id is null and exists (select 1 from users v where v.id = $1 and v.role = 'admin')))`

func (s *Store) LibraryPlaylists(ctx context.Context, viewer uuid.UUID) ([]PlaylistSummary, error) {
	rows, err := s.pool.Query(ctx, playlistSummarySQL+` where `+libraryPlaylistSQL+` group by p.id order by p.created_at`, viewer)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PlaylistSummary{}
	for rows.Next() {
		p, err := scanPlaylistSummary(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) PlaylistAccess(ctx context.Context, viewer, id uuid.UUID) (see, edit bool, err error) {
	err = s.pool.QueryRow(ctx, `select coalesce(`+libraryPlaylistSQL+`, false),
			coalesce(p.owner_id is not null and exists (select 1 from users o where o.id = p.owner_id and (
				p.visibility = 'public'
				or (p.visibility in ('friends', 'partner') and exists (select 1 from users u where u.id = p.owner_id and `+partnersSQL+`))
				or (p.visibility = 'friends' and exists (select 1 from users u where u.id = p.owner_id and `+friendsSQL+`)))), false)
		from playlists p where p.id = $2`, viewer, id).Scan(&edit, &see)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, false, ErrNotFound
	}
	return see || edit, edit, err
}
