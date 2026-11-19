package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const KindFindHighlight = "find_highlight"

const (
	PreviewsForYou  = "you"
	PreviewsFriends = "friends"
)

const PreviewBatch = 20

var PreviewReactions = map[string]bool{"like": true, "skip": true, "add": true, "send": true, "full": true}

type Highlight struct {
	StartMs int       `json:"start_ms"`
	Source  string    `json:"source"`
	Heat    []float32 `json:"heat,omitempty"`
}

type HighlightPayload struct {
	TrackID    uuid.UUID `json:"track_id"`
	VideoID    string    `json:"video_id"`
	Path       string    `json:"path"`
	DurationMs int       `json:"duration_ms"`
}

type HighlightResult struct {
	StartMs *int      `json:"start_ms"`
	Source  string    `json:"source"`
	Heat    []float32 `json:"heat"`
}

func HighlightKey(trackID uuid.UUID) string { return "highlight:" + trackID.String() }

func (s *Store) TrackHighlight(ctx context.Context, trackID uuid.UUID) (*Highlight, error) {
	var h Highlight
	err := s.pool.QueryRow(ctx, `select start_ms, source, coalesce(heat, '{}') from track_highlights where track_id = $1`, trackID).
		Scan(&h.StartMs, &h.Source, &h.Heat)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &h, err
}

const highlightSpecSQL = `select coalesce((select ts.external_id from track_sources ts where ts.track_id = t.id
		and ts.provider in ('ytmusic', 'youtube') order by (ts.status = 'selected') desc, ts.match_score desc nulls last limit 1), ''),
	coalesce((select ma.path from track_media tm join media_assets ma on ma.id = tm.asset_id
		where tm.track_id = t.id and tm.variant = 'main'), ''),
	coalesce(t.duration_ms, 0)
	from tracks t where t.id = $1`

func (s *Store) EnqueueHighlights(ctx context.Context, trackIDs []uuid.UUID, priority int) error {
	for _, id := range trackIDs {
		var have bool
		if err := s.pool.QueryRow(ctx, `select exists (select 1 from track_highlights where track_id = $1)`, id).Scan(&have); err != nil {
			return err
		}
		if have {
			continue
		}
		p := HighlightPayload{TrackID: id}
		if err := s.pool.QueryRow(ctx, highlightSpecSQL, id).Scan(&p.VideoID, &p.Path, &p.DurationMs); err != nil {
			if err == pgx.ErrNoRows {
				continue
			}
			return err
		}
		if p.VideoID == "" && p.Path == "" {
			continue
		}
		if _, _, err := s.Enqueue(ctx, JobSpec{Kind: KindFindHighlight, Payload: p, DedupeKey: HighlightKey(id), Priority: priority}); err != nil {
			return err
		}
	}
	return nil
}

func enqueueHighlightAfterDownload(ctx context.Context, tx pgx.Tx, trackID uuid.UUID) error {
	var wanted bool
	if err := tx.QueryRow(ctx, `select exists (select 1 from previews where track_id = $1)
		and not exists (select 1 from track_highlights where track_id = $1)`, trackID).Scan(&wanted); err != nil || !wanted {
		return err
	}
	p := HighlightPayload{TrackID: trackID}
	if err := tx.QueryRow(ctx, highlightSpecSQL, trackID).Scan(&p.VideoID, &p.Path, &p.DurationMs); err != nil {
		return err
	}
	_, _, err := enqueue(ctx, tx, JobSpec{Kind: KindFindHighlight, Payload: p, DedupeKey: HighlightKey(trackID), Priority: PriorityPrefetch})
	return err
}

func completeHighlight(ctx context.Context, tx pgx.Tx, payload, result []byte) error {
	var p HighlightPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	var r HighlightResult
	if err := json.Unmarshal(result, &r); err != nil {
		return fmt.Errorf("decode result: %w", err)
	}
	if r.StartMs == nil {
		return nil
	}
	if *r.StartMs < 0 || (r.Source != "replayed" && r.Source != "chorus") || len(r.Heat) > 200 {
		return fmt.Errorf("invalid highlight %+v", r)
	}
	var heat any
	if len(r.Heat) > 0 {
		heat = r.Heat
	}
	_, err := tx.Exec(ctx, `insert into track_highlights (track_id, start_ms, source, heat) values ($1, $2, $3, $4)
		on conflict (track_id) do update set start_ms = excluded.start_ms, source = excluded.source, heat = excluded.heat, updated_at = now()`,
		p.TrackID, *r.StartMs, r.Source, heat)
	return err
}

type Preview struct {
	Track     TrackView  `json:"track"`
	Mode      string     `json:"mode"`
	Reason    string     `json:"reason"`
	FromUser  *uuid.UUID `json:"from_user"`
	Highlight *Highlight `json:"highlight"`
	Seen      bool       `json:"seen"`
	Reaction  *string    `json:"reaction"`
}

func (s *Store) GeneratePreviews(ctx context.Context, userID uuid.UUID, now time.Time, loc *time.Location) (int, error) {
	d, err := s.LoadRecs(ctx, userID, now, loc)
	if err != nil {
		return 0, err
	}
	rows, err := s.pool.Query(ctx, `select track_id from previews where user_id = $1`, userID)
	if err != nil {
		return 0, err
	}
	known, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return 0, err
	}
	had := make(map[uuid.UUID]bool, len(known))
	for _, id := range known {
		had[id] = true
	}
	d.featurize(d.Cands, nil)
	fresh := make([]*Cand, 0, len(d.Cands))
	for _, c := range d.Cands {
		if c.New() && (c.TrackID == uuid.Nil || !had[c.TrackID]) {
			fresh = append(fresh, c)
		}
	}
	var start int
	if err := s.pool.QueryRow(ctx, `select coalesce(max(position) + 1, 0) from previews where user_id = $1 and mode = 'you'`, userID).Scan(&start); err != nil {
		return 0, err
	}
	added := 0
	var trackIDs []uuid.UUID
	for _, c := range Rerank(fresh, PreviewBatch, 1) {
		if c.TrackID == uuid.Nil {
			id, err := s.addCandidate(ctx, userID, c)
			if err != nil {
				return added, fmt.Errorf("add %q: %w", c.Title, err)
			}
			c.TrackID = id
		}
		if had[c.TrackID] {
			continue
		}
		had[c.TrackID] = true
		tag, err := s.pool.Exec(ctx, `insert into previews (user_id, track_id, mode, reason, position) values ($1, $2, 'you', $3, $4)
			on conflict do nothing`, userID, c.TrackID, d.reason(MixDaily, c).Label, start+added)
		if err != nil {
			return added, err
		}
		if tag.RowsAffected() == 1 {
			added++
			trackIDs = append(trackIDs, c.TrackID)
		}
	}
	frows, err := s.pool.Query(ctx, `insert into previews (user_id, track_id, mode, reason, from_user, position)
		select $1, l.track_id, 'friends', 'Liked by ' || u.display_name, l.user_id,
			(select coalesce(max(position) + 1, 0) from previews where user_id = $1 and mode = 'friends') + row_number() over (order by l.created_at desc)
		from (select distinct on (l.track_id) l.track_id, l.user_id, l.created_at from likes l
			join users u on u.id = l.user_id
			where l.created_at > $2 and l.user_id <> $1
				and u.activity_audience in ('followers', 'friends', 'partner') and (u.private_session_until is null or u.private_session_until < now())
				and exists (select 1 from follows a where a.follower_id = $1 and a.followee_id = l.user_id and a.status = 'accepted')
				and exists (select 1 from follows b where b.follower_id = l.user_id and b.followee_id = $1 and b.status = 'accepted')
				and (u.activity_audience <> 'partner' or exists (select 1 from pair_members x join pair_members y on y.pair_id = x.pair_id
					join pairs p on p.id = x.pair_id and p.ended_at is null and p.kind = 'partner' where x.user_id = $1 and y.user_id = l.user_id))
				and not exists (select 1 from likes m where m.user_id = $1 and m.track_id = l.track_id)
				and not exists (select 1 from previews v where v.user_id = $1 and v.mode = 'friends' and v.track_id = l.track_id)
			order by l.track_id, l.created_at desc) l
		join users u on u.id = l.user_id
		order by l.created_at desc limit $3
		on conflict do nothing returning track_id`, userID, now.Add(-30*24*time.Hour), PreviewBatch)
	if err != nil {
		return added, err
	}
	friendIDs, err := pgx.CollectRows(frows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return added, err
	}
	added += len(friendIDs)
	trackIDs = append(trackIDs, friendIDs...)
	if _, err := s.Prefetch(ctx, trackIDs); err != nil {
		return added, err
	}
	return added, s.EnqueueHighlights(ctx, trackIDs, PriorityPrefetch)
}

func (s *Store) Previews(ctx context.Context, userID uuid.UUID, mode string, limit int) ([]Preview, error) {
	rows, err := s.pool.Query(ctx, `select p.track_id, p.reason, p.from_user, p.seen_at is not null, p.reaction,
			h.start_ms, h.source, coalesce(h.heat, '{}')
		from previews p left join track_highlights h on h.track_id = p.track_id
		where p.user_id = $1 and p.mode = $2 and (p.reaction is null or p.reaction not in ('skip', 'like'))
			and not exists (select 1 from hidden_items hi where hi.user_id = $1 and hi.item_type = 'track' and hi.item_id = p.track_id)
		order by p.seen_at is not null, p.position limit $3`, userID, mode, limit)
	if err != nil {
		return nil, err
	}
	type row struct {
		Preview
		start  *int
		source *string
		heat   []float32
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (row, error) {
		var x row
		x.Mode = mode
		return x, r.Scan(&x.Track.ID, &x.Reason, &x.FromUser, &x.Seen, &x.Reaction, &x.start, &x.source, &x.heat)
	})
	if err != nil {
		return nil, err
	}
	ids := make([]uuid.UUID, len(list))
	for i, x := range list {
		ids[i] = x.Track.ID
	}
	views, err := s.viewsByID(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]Preview, 0, len(list))
	for _, x := range list {
		v, ok := views[x.Track.ID]
		if !ok {
			continue
		}
		x.Track = v
		if x.start != nil && x.source != nil {
			x.Highlight = &Highlight{StartMs: *x.start, Source: *x.source, Heat: x.heat}
		}
		out = append(out, x.Preview)
	}
	return out, nil
}

func (s *Store) PreviewsGeneratedAt(ctx context.Context, userID uuid.UUID) (time.Time, error) {
	var at *time.Time
	err := s.pool.QueryRow(ctx, `select max(created_at) from previews where user_id = $1`, userID).Scan(&at)
	if err != nil || at == nil {
		return time.Time{}, err
	}
	return *at, nil
}

func (s *Store) ReactPreview(ctx context.Context, userID, trackID uuid.UUID, reaction string) error {
	var r any
	if reaction != "" {
		r = reaction
	}
	_, err := s.pool.Exec(ctx, `update previews set seen_at = coalesce(seen_at, now()), reaction = coalesce($3, reaction)
		where user_id = $1 and track_id = $2`, userID, trackID, r)
	return err
}
