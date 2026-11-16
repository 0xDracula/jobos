package store

import (
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool                       *pgxpool.Pool
	BackgroundDownloadInterval time.Duration
}

func New(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool, BackgroundDownloadInterval: 20 * time.Second}
}

func newID() uuid.UUID {
	return uuid.Must(uuid.NewV7())
}
