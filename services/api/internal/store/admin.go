package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type SourceHealth struct {
	Source      string     `json:"source"`
	LastOKAt    *time.Time `json:"last_ok_at"`
	LastErrorAt *time.Time `json:"last_error_at"`
	LastError   *string    `json:"last_error"`
}

type JobCount struct {
	Kind   string `json:"kind"`
	Status string `json:"status"`
	Count  int    `json:"count"`
}

type FailedJob struct {
	ID         int64      `json:"id"`
	Kind       string     `json:"kind"`
	TrackID    *uuid.UUID `json:"track_id"`
	Title      *string    `json:"title"`
	Attempts   int32      `json:"attempts"`
	LastError  *string    `json:"last_error"`
	FinishedAt *time.Time `json:"finished_at"`
}

type CacheStats struct {
	AudioFiles     int   `json:"audio_files"`
	AudioBytes     int64 `json:"audio_bytes"`
	PinnedFiles    int   `json:"pinned_files"`
	PinnedBytes    int64 `json:"pinned_bytes"`
	ClearableFiles int   `json:"clearable_files"`
	ClearableBytes int64 `json:"clearable_bytes"`
	ImageFiles     int   `json:"image_files"`
	ImageBytes     int64 `json:"image_bytes"`
}

type LoudFile struct {
	TrackID    uuid.UUID `json:"track_id"`
	Title      string    `json:"title"`
	TruePeakDB float32   `json:"true_peak_db"`
}

type AdminStatus struct {
	Sources     []SourceHealth `json:"sources"`
	Jobs        []JobCount     `json:"jobs"`
	Failed      []FailedJob    `json:"failed"`
	Cache       CacheStats     `json:"cache"`
	LoudFiles   []LoudFile     `json:"loud_files"`
	Unmeasured  int            `json:"unmeasured_files"`
	OffTarget   int            `json:"off_target_files"`
	YtdlpUpdate *YtdlpUpdate   `json:"ytdlp_update"`
}

const pinnedSQL = `exists (select 1 from track_media tm where tm.asset_id = ma.id and (
		exists (select 1 from playlist_items pi where pi.track_id = tm.track_id)
		or exists (select 1 from track_sources s where s.track_id = tm.track_id and s.provider = 'upload')))`

func (s *Store) AdminStatus(ctx context.Context) (*AdminStatus, error) {
	st := &AdminStatus{}
	rows, err := s.pool.Query(ctx, `select provider, last_ok_at, last_error_at, last_error from source_status order by provider`)
	if err != nil {
		return nil, err
	}
	if st.Sources, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (SourceHealth, error) {
		var h SourceHealth
		return h, row.Scan(&h.Source, &h.LastOKAt, &h.LastErrorAt, &h.LastError)
	}); err != nil {
		return nil, err
	}
	rows, err = s.pool.Query(ctx, `select kind, status, count(*) from jobs
		where status in ('queued', 'running', 'failed') or finished_at > now() - interval '1 day'
		group by kind, status order by kind, status`)
	if err != nil {
		return nil, err
	}
	if st.Jobs, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (JobCount, error) {
		var c JobCount
		return c, row.Scan(&c.Kind, &c.Status, &c.Count)
	}); err != nil {
		return nil, err
	}
	rows, err = s.pool.Query(ctx, `select j.id, j.kind, t.id, t.title, j.attempts, j.last_error, j.finished_at
		from jobs j left join tracks t on t.id::text = j.payload->>'track_id'
		where j.status = 'failed' order by j.finished_at desc nulls last limit 50`)
	if err != nil {
		return nil, err
	}
	if st.Failed, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (FailedJob, error) {
		var f FailedJob
		return f, row.Scan(&f.ID, &f.Kind, &f.TrackID, &f.Title, &f.Attempts, &f.LastError, &f.FinishedAt)
	}); err != nil {
		return nil, err
	}
	c := &st.Cache
	if err := s.pool.QueryRow(ctx, `select count(*), coalesce(sum(bytes), 0),
			count(*) filter (where pinned), coalesce(sum(bytes) filter (where pinned), 0)
		from (select ma.bytes, `+pinnedSQL+` as pinned from media_assets ma where ma.kind = 'audio') a`).
		Scan(&c.AudioFiles, &c.AudioBytes, &c.PinnedFiles, &c.PinnedBytes); err != nil {
		return nil, err
	}
	c.ClearableFiles, c.ClearableBytes = c.AudioFiles-c.PinnedFiles, c.AudioBytes-c.PinnedBytes
	if err := s.pool.QueryRow(ctx, `select count(*), coalesce(sum(bytes), 0) from media_assets where kind in ('artwork', 'image')`).
		Scan(&c.ImageFiles, &c.ImageBytes); err != nil {
		return nil, err
	}
	rows, err = s.pool.Query(ctx, `select t.id, t.title, ma.output_true_peak_db from track_media tm
		join tracks t on t.id = tm.track_id join media_assets ma on ma.id = tm.asset_id
		where tm.variant = 'main' and ma.output_true_peak_db > -1 order by ma.output_true_peak_db desc limit 50`)
	if err != nil {
		return nil, err
	}
	if st.LoudFiles, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (LoudFile, error) {
		var l LoudFile
		return l, row.Scan(&l.TrackID, &l.Title, &l.TruePeakDB)
	}); err != nil {
		return nil, err
	}
	if err := s.pool.QueryRow(ctx, `select count(*) from media_assets where kind = 'audio' and output_true_peak_db is null`).Scan(&st.Unmeasured); err != nil {
		return nil, err
	}
	if err := s.pool.QueryRow(ctx, `select count(*) from track_media tm join media_assets ma on ma.id = tm.asset_id
		where tm.variant = 'main' and ma.kind = 'audio' and `+offTargetSQL).Scan(&st.OffTarget); err != nil {
		return nil, err
	}
	st.YtdlpUpdate, err = s.ytdlpUpdate(ctx)
	return st, err
}

func (s *Store) RetryJob(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `update jobs set status = 'queued', attempts = 0, run_after = now(), last_error = null,
		finished_at = null, locked_by = null where id = $1 and status = 'failed'`, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

type ClearedFile struct {
	Path  string
	Bytes int64
}

func (s *Store) ClearUnpinned(ctx context.Context) ([]ClearedFile, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `delete from track_media tm where tm.variant = 'main'
		and not exists (select 1 from playlist_items pi where pi.track_id = tm.track_id)
		and not exists (select 1 from track_sources s where s.track_id = tm.track_id and s.provider = 'upload')`); err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `delete from media_assets ma where ma.kind = 'audio'
		and not exists (select 1 from track_media tm where tm.asset_id = ma.id) returning path, bytes`)
	if err != nil {
		return nil, err
	}
	files, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (ClearedFile, error) {
		var f ClearedFile
		return f, row.Scan(&f.Path, &f.Bytes)
	})
	if err != nil {
		return nil, err
	}
	return files, tx.Commit(ctx)
}
