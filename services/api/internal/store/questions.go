package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type DailyQuestion struct {
	ID        uuid.UUID `json:"id"`
	AuthorID  uuid.UUID `json:"author_id"`
	Body      string    `json:"body"`
	Kind      string    `json:"kind"`
	Position  int       `json:"position"`
	AskedOn   *string   `json:"asked_on"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type DailyAnswer struct {
	QuestionID uuid.UUID  `json:"question_id"`
	UserID     uuid.UUID  `json:"user_id"`
	Body       string     `json:"body"`
	TrackID    *uuid.UUID `json:"track_id"`
	Track      *TrackView `json:"track"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

const questionCols = `id, author_id, body, kind, position, to_char(asked_on, 'YYYY-MM-DD'), created_at, updated_at`

func scanQuestion(r pgx.Row) (DailyQuestion, error) {
	var q DailyQuestion
	err := r.Scan(&q.ID, &q.AuthorID, &q.Body, &q.Kind, &q.Position, &q.AskedOn, &q.CreatedAt, &q.UpdatedAt)
	return q, err
}

func (s *Store) QuestionOn(ctx context.Context, day time.Time) (*DailyQuestion, error) {
	for attempt := 0; attempt < 2; attempt++ {
		q, err := scanQuestion(s.pool.QueryRow(ctx, `select `+questionCols+` from daily_questions where asked_on = $1`, day))
		if err == nil {
			return &q, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		q, err = scanQuestion(s.pool.QueryRow(ctx, `update daily_questions set asked_on = $1, updated_at = now()
			where id = (select id from daily_questions where asked_on is null order by position, created_at limit 1 for update skip locked)
			returning `+questionCols, day))
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			continue
		}
		if err != nil {
			return nil, err
		}
		return &q, nil
	}
	return nil, errors.New("daily question: no question for the day")
}

func (s *Store) AskedBefore(ctx context.Context, day time.Time, limit int) ([]DailyQuestion, error) {
	rows, err := s.pool.Query(ctx, `select `+questionCols+` from daily_questions where asked_on < $1 order by asked_on desc limit $2`, day, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (DailyQuestion, error) { return scanQuestion(r) })
}

func (s *Store) DailyQuestions(ctx context.Context) ([]DailyQuestion, error) {
	rows, err := s.pool.Query(ctx, `select `+questionCols+` from daily_questions
		order by asked_on is not null, asked_on desc, position, created_at`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (DailyQuestion, error) { return scanQuestion(r) })
}

func (s *Store) DailyQuestion(ctx context.Context, id uuid.UUID) (*DailyQuestion, error) {
	q, err := scanQuestion(s.pool.QueryRow(ctx, `select `+questionCols+` from daily_questions where id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &q, err
}

func (s *Store) CreateDailyQuestion(ctx context.Context, author uuid.UUID, body, kind string) (*DailyQuestion, error) {
	q, err := scanQuestion(s.pool.QueryRow(ctx, `insert into daily_questions (id, author_id, body, kind, position)
		values ($1, $2, $3, $4, coalesce((select max(position) + 1 from daily_questions), 0)) returning `+questionCols,
		newID(), author, body, kind))
	return &q, err
}

func (s *Store) UpdateDailyQuestion(ctx context.Context, id uuid.UUID, body, kind string) error {
	tag, err := s.pool.Exec(ctx, `update daily_questions set body = $2, kind = $3, updated_at = now() where id = $1`, id, body, kind)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) DeleteDailyQuestion(ctx context.Context, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `delete from daily_questions where id = $1`, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) OrderDailyQuestions(ctx context.Context, ids []uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `update daily_questions q set position = o.n - 1, updated_at = now()
		from unnest($1::uuid[]) with ordinality as o(id, n) where q.id = o.id and q.asked_on is null`, ids)
	return err
}

func (s *Store) DailyAnswers(ctx context.Context, ids []uuid.UUID) ([]DailyAnswer, error) {
	if len(ids) == 0 {
		return []DailyAnswer{}, nil
	}
	rows, err := s.pool.Query(ctx, `select question_id, user_id, body, track_id, created_at, updated_at from daily_answers
		where question_id = any($1)`, ids)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (DailyAnswer, error) {
		var a DailyAnswer
		return a, r.Scan(&a.QuestionID, &a.UserID, &a.Body, &a.TrackID, &a.CreatedAt, &a.UpdatedAt)
	})
	if err != nil {
		return nil, err
	}
	var trackIDs []uuid.UUID
	for _, a := range list {
		if a.TrackID != nil {
			trackIDs = append(trackIDs, *a.TrackID)
		}
	}
	tracks, err := s.TracksByID(ctx, trackIDs)
	if err != nil {
		return nil, err
	}
	byID := map[uuid.UUID]*TrackView{}
	for i := range tracks {
		byID[tracks[i].ID] = &tracks[i]
	}
	for i := range list {
		if list[i].TrackID != nil {
			list[i].Track = byID[*list[i].TrackID]
		}
	}
	return list, nil
}

func (s *Store) SetDailyAnswer(ctx context.Context, questionID, userID uuid.UUID, body string, trackID *uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `insert into daily_answers (question_id, user_id, body, track_id) values ($1, $2, $3, $4)
		on conflict (question_id, user_id) do update set body = excluded.body, track_id = excluded.track_id, updated_at = now()`,
		questionID, userID, body, trackID)
	return err
}
