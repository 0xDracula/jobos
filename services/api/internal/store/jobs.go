package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	KindDownloadTrack = "download_track"
	KindMatchTrack    = "match_track"
	KindProcessUpload = "process_upload"
	KindProcessCover  = "process_cover"

	PriorityInteractive = 10
	PriorityPrefetch    = 5
	PriorityMatch       = 1
	PriorityBackground  = 0
)

var (
	ErrJobNotRunning = errors.New("job is not running")
	shaRE            = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

type Job struct {
	ID       int64           `json:"id"`
	Kind     string          `json:"kind"`
	Payload  json.RawMessage `json:"payload"`
	Attempts int32           `json:"attempts"`
}

type DownloadPayload struct {
	TrackID    uuid.UUID `json:"track_id"`
	SourceID   uuid.UUID `json:"source_id"`
	Provider   string    `json:"provider"`
	ExternalID string    `json:"external_id"`
}

func DownloadKey(sourceID uuid.UUID) string {
	return "download:" + sourceID.String()
}

func Backoff(attempt int32) time.Duration {
	switch {
	case attempt <= 1:
		return time.Minute
	case attempt == 2:
		return 10 * time.Minute
	default:
		return time.Hour
	}
}

type JobSpec struct {
	Queue     string
	Kind      string
	Payload   any
	DedupeKey string
	Priority  int
}

type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func (s *Store) Enqueue(ctx context.Context, j JobSpec) (id int64, added bool, err error) {
	return enqueue(ctx, s.pool, j)
}

func enqueue(ctx context.Context, q querier, j JobSpec) (id int64, added bool, err error) {
	body, err := json.Marshal(j.Payload)
	if err != nil {
		return 0, false, err
	}
	if j.Queue == "" {
		j.Queue = "default"
	}
	var dedupe *string
	if j.DedupeKey != "" {
		dedupe = &j.DedupeKey
	}
	err = q.QueryRow(ctx, `insert into jobs (queue, kind, payload, dedupe_key, priority) values ($1, $2, $3, $4, $5)
		on conflict (dedupe_key) where dedupe_key is not null and status in ('queued', 'running')
		do update set priority = greatest(jobs.priority, excluded.priority),
			run_after = case when excluded.priority > jobs.priority then least(jobs.run_after, now()) else jobs.run_after end
		returning id, xmax = 0`, j.Queue, j.Kind, body, dedupe, j.Priority).Scan(&id, &added)
	return id, added, err
}

func (s *Store) ClaimJob(ctx context.Context, queue, worker string, kinds []string) (*Job, error) {
	if _, err := s.pool.Exec(ctx, `update jobs set status = 'queued', locked_by = null, locked_at = null
		where status = 'running' and locked_at < now() - interval '30 minutes'`); err != nil {
		return nil, err
	}
	var j Job
	var payload []byte
	err := s.pool.QueryRow(ctx, `update jobs set status = 'running', locked_by = $2, locked_at = now(), attempts = attempts + 1
		where id = (
			select id from jobs
			where queue = $1 and status = 'queued' and run_after <= now() and kind = any($3)
				and not (kind = $4 and priority <= 0 and exists (
					select 1 from jobs r where r.kind = $4 and r.priority <= 0
						and r.locked_at > now() - make_interval(secs => $5)))
			order by priority desc, id
			for update skip locked
			limit 1)
		returning id, kind, payload, attempts`,
		queue, worker, kinds, KindDownloadTrack, s.BackgroundDownloadInterval.Seconds()).Scan(&j.ID, &j.Kind, &payload, &j.Attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	j.Payload = payload
	return &j, nil
}

type AssetResult struct {
	SHA256           string          `json:"sha256"`
	Path             string          `json:"path"`
	Kind             string          `json:"kind"`
	Mime             string          `json:"mime"`
	Bytes            int64           `json:"bytes"`
	DurationMs       *int32          `json:"duration_ms"`
	Bitrate          *int32          `json:"bitrate"`
	LoudnessLUFS     *float64        `json:"loudness_lufs"`
	TruePeakDB       *float64        `json:"true_peak_db"`
	GainDB           *float64        `json:"gain_db"`
	Waveform         json.RawMessage `json:"waveform"`
	Width            *int32          `json:"width"`
	Height           *int32          `json:"height"`
	Palette          json.RawMessage `json:"palette"`
	OutputLUFS       *float64        `json:"output_lufs"`
	OutputTruePeakDB *float64        `json:"output_true_peak_db"`
	AnalysisFields
}

type DownloadResult struct {
	Asset  AssetResult `json:"asset"`
	Source struct {
		Title    *string `json:"title"`
		Uploader *string `json:"uploader"`
	} `json:"source"`
}

func (a AssetResult) Validate() error {
	want := fmt.Sprintf("%s/%s/%s/%s.", a.Kind, safePrefix(a.SHA256, 0, 2), safePrefix(a.SHA256, 2, 4), a.SHA256)
	switch {
	case !shaRE.MatchString(a.SHA256):
		return errors.New("invalid sha256")
	case !strings.HasPrefix(a.Path, want) || strings.Contains(a.Path, ".."):
		return fmt.Errorf("path %q does not match its hash", a.Path)
	case a.Bytes <= 0:
		return errors.New("empty file")
	}
	return a.AnalysisFields.Validate()
}

func safePrefix(s string, from, to int) string {
	if len(s) < to {
		return ""
	}
	return s[from:to]
}

func (s *Store) CompleteJob(ctx context.Context, id int64, result json.RawMessage) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var kind string
	var payload []byte
	var priority int
	err = tx.QueryRow(ctx, `select kind, payload, priority from jobs where id = $1 and status = 'running' for update`, id).
		Scan(&kind, &payload, &priority)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrJobNotRunning
	}
	if err != nil {
		return err
	}
	switch kind {
	case KindDownloadTrack:
		err = completeDownload(ctx, tx, payload, result, priority)
	case KindMatchTrack:
		err = completeMatch(ctx, tx, payload, result)
	case KindFetchLyrics:
		err = completeLyrics(ctx, tx, payload, result)
	case KindEnrichMetadata:
		err = completeEnrich(ctx, tx, payload, result)
	case KindProcessUpload:
		err = completeUpload(ctx, tx, payload, result, priority)
	case KindProcessCover:
		err = completeCover(ctx, tx, payload, result)
	case KindAnalyzeAudio:
		err = completeAnalysis(ctx, tx, payload, result)
	}
	if err != nil {
		return err
	}
	if key := sourceKey(kind, payload); key != "" {
		if err := recordSource(ctx, tx, key, ""); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `update jobs set status = 'done', finished_at = now(), result = $2, last_error = null where id = $1`,
		id, []byte(result)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func completeDownload(ctx context.Context, tx pgx.Tx, payload, result []byte, priority int) error {
	var p DownloadPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	var r DownloadResult
	if err := json.Unmarshal(result, &r); err != nil {
		return fmt.Errorf("decode result: %w", err)
	}
	a := r.Asset
	if err := a.Validate(); err != nil {
		return err
	}
	assetID, err := insertAsset(ctx, tx, a)
	if err != nil {
		return err
	}
	linked, err := tx.Exec(ctx, `insert into track_media (track_id, variant, track_source_id, asset_id)
		select $1, 'main', $2, $3 where exists (select 1 from track_sources where id = $2 and status = 'selected')
		on conflict (track_id, variant) do update set track_source_id = excluded.track_source_id, asset_id = excluded.asset_id`,
		p.TrackID, p.SourceID, assetID)
	if err != nil {
		return err
	}
	if linked.RowsAffected() == 1 {
		if _, err := enqueueEnrich(ctx, tx, p.TrackID, priority); err != nil {
			return err
		}
		var looked bool
		if err := tx.QueryRow(ctx, `select exists (select 1 from lyrics where track_id = $1)`, p.TrackID).Scan(&looked); err != nil {
			return err
		}
		if !looked {
			if _, err := enqueueLyrics(ctx, tx, p.TrackID, priority); err != nil {
				return err
			}
		}
	}
	if _, err := tx.Exec(ctx, `update track_sources set uploader = coalesce($2, uploader), raw_title = coalesce($3, raw_title),
		updated_at = now() where id = $1`, p.SourceID, r.Source.Uploader, r.Source.Title); err != nil {
		return err
	}
	return nil
}

func sourceKey(kind string, payload []byte) string {
	switch kind {
	case KindDownloadTrack:
		var p DownloadPayload
		if json.Unmarshal(payload, &p) == nil {
			return p.Provider
		}
	case KindMatchTrack:
		return "search"
	case KindFetchLyrics:
		return "lyrics"
	case KindEnrichMetadata:
		return "deezer"
	}
	return ""
}

func recordSource(ctx context.Context, tx pgx.Tx, key, message string) error {
	if message == "" {
		_, err := tx.Exec(ctx, `insert into source_status (provider, last_ok_at, updated_at) values ($1, now(), now())
			on conflict (provider) do update set last_ok_at = now(), updated_at = now()`, key)
		return err
	}
	_, err := tx.Exec(ctx, `insert into source_status (provider, last_error_at, last_error, updated_at) values ($1, now(), $2, now())
		on conflict (provider) do update set last_error_at = now(), last_error = excluded.last_error, updated_at = now()`, key, message)
	return err
}

func insertAsset(ctx context.Context, tx pgx.Tx, a AssetResult) (uuid.UUID, error) {
	jsonOrNil := func(raw json.RawMessage) []byte {
		if len(raw) == 0 || string(raw) == "null" {
			return nil
		}
		return raw
	}
	var id uuid.UUID
	const newer = `coalesce(excluded.analysis_version, 0) >= coalesce(media_assets.analysis_version, 0)`
	err := tx.QueryRow(ctx, `insert into media_assets
			(id, sha256, kind, path, mime, bytes, duration_ms, bitrate, loudness_lufs, true_peak_db, gain_db, waveform,
			 width, height, palette, output_lufs, output_true_peak_db, tempo_bpm, beats,
			 energy, valence, danceability, musical_key, analysis_version)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
		on conflict (sha256) do update set path = excluded.path,
			width = coalesce(excluded.width, media_assets.width), height = coalesce(excluded.height, media_assets.height),
			palette = coalesce(excluded.palette, media_assets.palette),
			tempo_bpm = coalesce(excluded.tempo_bpm, media_assets.tempo_bpm), beats = coalesce(excluded.beats, media_assets.beats),
			energy = case when `+newer+` then excluded.energy else media_assets.energy end,
			valence = case when `+newer+` then excluded.valence else media_assets.valence end,
			danceability = case when `+newer+` then excluded.danceability else media_assets.danceability end,
			musical_key = case when `+newer+` then excluded.musical_key else media_assets.musical_key end,
			analysis_version = greatest(excluded.analysis_version, media_assets.analysis_version)
		returning id`,
		newID(), a.SHA256, a.Kind, a.Path, a.Mime, a.Bytes, a.DurationMs, a.Bitrate,
		a.LoudnessLUFS, a.TruePeakDB, a.GainDB, jsonOrNil(a.Waveform), a.Width, a.Height, jsonOrNil(a.Palette),
		a.OutputLUFS, a.OutputTruePeakDB, a.TempoBPM, jsonOrNil(a.Beats),
		a.Energy, a.Valence, a.Danceability, a.MusicalKey, a.AnalysisVersion).Scan(&id)
	return id, err
}

func (s *Store) FailJob(ctx context.Context, id int64, message string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var attempts, maxAttempts int32
	var kind string
	var payload []byte
	err = tx.QueryRow(ctx, `select attempts, max_attempts, kind, payload from jobs where id = $1 and status = 'running' for update`, id).
		Scan(&attempts, &maxAttempts, &kind, &payload)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrJobNotRunning
	}
	if err != nil {
		return err
	}
	if attempts >= maxAttempts {
		_, err = tx.Exec(ctx, `update jobs set status = 'failed', finished_at = now(), last_error = $2, locked_by = null, locked_at = null
			where id = $1`, id, message)
	} else {
		_, err = tx.Exec(ctx, `update jobs set status = 'queued', run_after = now() + make_interval(secs => $3), last_error = $2,
			locked_by = null where id = $1`, id, message, Backoff(attempts).Seconds())
	}
	if err != nil {
		return err
	}
	if kind == KindMatchTrack && attempts >= maxAttempts {
		var p MatchPayload
		if json.Unmarshal(payload, &p) == nil {
			if _, err := tx.Exec(ctx, `update tracks set match_status = 'unmatched', updated_at = now()
				where id = $1 and match_status = 'pending'`, p.TrackID); err != nil {
				return err
			}
		}
	}
	if key := sourceKey(kind, payload); key != "" {
		if err := recordSource(ctx, tx, key, message); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
