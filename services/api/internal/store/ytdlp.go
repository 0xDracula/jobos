package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"
)

const KindUpdateYtdlp = "update_ytdlp"

const YtdlpUpdateKey = "update_ytdlp"

type YtdlpUpdateResult struct {
	Result   string  `json:"result"`
	Version  *string `json:"version"`
	Previous *string `json:"previous"`
	Latest   *string `json:"latest"`
}

var ytdlpVersionRE = regexp.MustCompile(`^[0-9]{4}(\.[0-9]{1,6}){2,3}$`)

func (r YtdlpUpdateResult) Validate() error {
	if r.Result != "updated" && r.Result != "current" {
		return fmt.Errorf("unknown result %q", r.Result)
	}
	for _, v := range []*string{r.Version, r.Previous, r.Latest} {
		if v != nil && *v != "" && !ytdlpVersionRE.MatchString(*v) {
			return fmt.Errorf("invalid version %q", *v)
		}
	}
	if r.Result == "updated" && (r.Version == nil || *r.Version == "") {
		return errors.New("an update needs its version")
	}
	return nil
}

func completeYtdlpUpdate(result []byte) error {
	var r YtdlpUpdateResult
	if err := json.Unmarshal(result, &r); err != nil {
		return fmt.Errorf("decode result: %w", err)
	}
	return r.Validate()
}

type YtdlpUpdate struct {
	LastRunAt     *time.Time `json:"last_run_at"`
	LastResult    *string    `json:"last_result"`
	LastError     *string    `json:"last_error"`
	LastUpdatedAt *time.Time `json:"last_updated_at"`
	Version       *string    `json:"version"`
	Queued        bool       `json:"queued"`
}

func (s *Store) ytdlpUpdate(ctx context.Context) (*YtdlpUpdate, error) {
	u := &YtdlpUpdate{}
	var status string
	var result *string
	err := s.pool.QueryRow(ctx, `select coalesce(finished_at, locked_at), status, result->>'result', last_error from jobs
		where kind = $1 and (status in ('done', 'failed') or last_error is not null)
		order by id desc limit 1`, KindUpdateYtdlp).Scan(&u.LastRunAt, &status, &result, &u.LastError)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
	case err != nil:
		return nil, err
	case status == "done":
		u.LastResult, u.LastError = result, nil
	default:
		failed := "failed"
		u.LastResult = &failed
	}
	err = s.pool.QueryRow(ctx, `select finished_at, result->>'version' from jobs
		where kind = $1 and status = 'done' and result->>'result' = 'updated'
		order by finished_at desc limit 1`, KindUpdateYtdlp).Scan(&u.LastUpdatedAt, &u.Version)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	err = s.pool.QueryRow(ctx, `select exists (select 1 from jobs where kind = $1 and status in ('queued', 'running'))`,
		KindUpdateYtdlp).Scan(&u.Queued)
	return u, err
}

func (s *Store) LastJobAt(ctx context.Context, kind string) (*time.Time, error) {
	var at *time.Time
	err := s.pool.QueryRow(ctx, `select max(created_at) from jobs where kind = $1`, kind).Scan(&at)
	return at, err
}
