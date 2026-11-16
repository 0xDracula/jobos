package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const KindFetchLyrics = "fetch_lyrics"

func LyricsKey(trackID uuid.UUID) string {
	return "lyrics:" + trackID.String()
}

type LyricsPayload struct {
	TrackID        uuid.UUID `json:"track_id"`
	Title          string    `json:"title"`
	Artists        []string  `json:"artists"`
	Album          string    `json:"album,omitempty"`
	DurationMs     int32     `json:"duration_ms,omitempty"`
	Provider       string    `json:"provider,omitempty"`
	ExternalID     string    `json:"external_id,omitempty"`
	FileDurationMs int32     `json:"file_duration_ms,omitempty"`
}

type LyricsResult struct {
	Source       *string `json:"source"`
	SyncedLRC    *string `json:"synced_lrc"`
	Plain        *string `json:"plain"`
	Instrumental bool    `json:"instrumental"`
	DurationMs   *int32  `json:"duration_ms"`
}

const maxLyricsBytes = 256 << 10

func (r LyricsResult) Validate() error {
	if r.Source != nil && *r.Source != "lrclib" && *r.Source != "ytmusic" {
		return fmt.Errorf("unknown lyrics source %q", *r.Source)
	}
	if (r.SyncedLRC != nil || r.Plain != nil || r.Instrumental) && r.Source == nil {
		return errors.New("lyrics need a source")
	}
	for _, s := range []*string{r.SyncedLRC, r.Plain} {
		if s != nil && len(*s) > maxLyricsBytes {
			return errors.New("lyrics too long")
		}
	}
	if r.SyncedLRC != nil {
		if _, err := ParseLRC(*r.SyncedLRC); err != nil {
			return fmt.Errorf("synced lyrics: %w", err)
		}
	}
	return nil
}

type LyricLine struct {
	TimeMs int    `json:"time_ms"`
	Text   string `json:"text"`
}

var lrcTimeRE = regexp.MustCompile(`^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]`)

func ParseLRC(s string) ([]LyricLine, error) {
	var out []LyricLine
	for _, line := range strings.Split(s, "\n") {
		rest := strings.TrimRight(line, "\r")
		var times []int
		for {
			m := lrcTimeRE.FindStringSubmatch(rest)
			if m == nil {
				break
			}
			minutes, _ := strconv.Atoi(m[1])
			seconds, _ := strconv.Atoi(m[2])
			frac := 0
			if m[3] != "" {
				frac, _ = strconv.Atoi((m[3] + "00")[:3])
			}
			times = append(times, (minutes*60+seconds)*1000+frac)
			rest = rest[len(m[0]):]
		}
		text := strings.TrimSpace(rest)
		for _, t := range times {
			out = append(out, LyricLine{TimeMs: t, Text: text})
		}
	}
	if len(out) == 0 {
		return nil, errors.New("no timed lines")
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].TimeMs < out[j].TimeMs })
	return out, nil
}

func enqueueLyrics(ctx context.Context, q querier, trackID uuid.UUID, priority int) (bool, error) {
	p := LyricsPayload{TrackID: trackID}
	var album, provider, externalID *string
	var duration, fileDuration *int32
	err := q.QueryRow(ctx, `select t.title, al.title, t.duration_ms,
			coalesce((select array_agg(a.name order by ta.position) from track_artists ta
				join artists a on a.id = ta.artist_id where ta.track_id = t.id), '{}'),
			ts.provider, ts.external_id, ma.duration_ms
		from tracks t
		left join albums al on al.id = t.album_id
		left join track_sources ts on ts.track_id = t.id and ts.status = 'selected'
		left join track_media tm on tm.track_id = t.id and tm.variant = 'main'
		left join media_assets ma on ma.id = tm.asset_id
		where t.id = $1`, trackID).Scan(&p.Title, &album, &duration, &p.Artists, &provider, &externalID, &fileDuration)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrNotFound
	}
	if err != nil {
		return false, err
	}
	if album != nil {
		p.Album = *album
	}
	if duration != nil {
		p.DurationMs = *duration
	}
	if provider != nil && externalID != nil {
		p.Provider, p.ExternalID = *provider, *externalID
	}
	if fileDuration != nil {
		p.FileDurationMs = *fileDuration
	}
	_, added, err := enqueue(ctx, q, JobSpec{Kind: KindFetchLyrics, Payload: p, DedupeKey: LyricsKey(trackID), Priority: priority})
	return added, err
}

func completeLyrics(ctx context.Context, tx pgx.Tx, payload, result []byte) error {
	var p LyricsPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	var r LyricsResult
	if err := json.Unmarshal(result, &r); err != nil {
		return fmt.Errorf("decode result: %w", err)
	}
	if err := r.Validate(); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `insert into lyrics (track_id, synced_lrc, plain, source, instrumental, duration_ms)
		select $1, $2, $3, $4, $5, $6 where exists (select 1 from tracks where id = $1)
		on conflict (track_id) do update set synced_lrc = excluded.synced_lrc, plain = excluded.plain,
			source = excluded.source, instrumental = excluded.instrumental, duration_ms = excluded.duration_ms,
			updated_at = now()
		where lyrics.source is distinct from 'manual'`,
		p.TrackID, r.SyncedLRC, r.Plain, r.Source, r.Instrumental, r.DurationMs)
	return err
}

func (s *Store) BackfillLyrics(ctx context.Context) (int, error) {
	rows, err := s.pool.Query(ctx, `select t.id from tracks t
		where exists (select 1 from track_media tm where tm.track_id = t.id and tm.variant = 'main')
			and not exists (select 1 from lyrics l where l.track_id = t.id)
		order by t.created_at`)
	if err != nil {
		return 0, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return 0, err
	}
	n := 0
	for _, id := range ids {
		added, err := enqueueLyrics(ctx, s.pool, id, PriorityMatch)
		if err != nil {
			return n, err
		}
		if added {
			n++
		}
	}
	return n, nil
}

type LyricsView struct {
	Status     string      `json:"status"`
	Source     *string     `json:"source"`
	Lines      []LyricLine `json:"lines,omitempty"`
	Plain      *string     `json:"plain"`
	OffsetMs   int32       `json:"offset_ms"`
	DurationMs *int32      `json:"duration_ms"`
}

func (s *Store) Lyrics(ctx context.Context, trackID uuid.UUID) (*LyricsView, error) {
	var v LyricsView
	var synced *string
	var instrumental bool
	err := s.pool.QueryRow(ctx, `select source, synced_lrc, plain, instrumental, offset_ms, duration_ms
		from lyrics where track_id = $1`, trackID).Scan(&v.Source, &synced, &v.Plain, &instrumental, &v.OffsetMs, &v.DurationMs)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if synced != nil {
		if lines, err := ParseLRC(*synced); err == nil {
			v.Status, v.Lines = "synced", lines
			return &v, nil
		}
	}
	switch {
	case v.Plain != nil && strings.TrimSpace(*v.Plain) != "":
		v.Status = "plain"
	case instrumental:
		v.Status = "instrumental"
	default:
		v.Status = "none"
	}
	return &v, nil
}

const MaxLyricsOffsetMs = 600_000

func (s *Store) SetLyricsOffset(ctx context.Context, trackID uuid.UUID, offsetMs int32) error {
	tag, err := s.pool.Exec(ctx, `update lyrics set offset_ms = $2, updated_at = now() where track_id = $1`, trackID, offsetMs)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}
