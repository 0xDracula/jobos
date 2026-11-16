package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type PlaylistEdit struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
}

func (e PlaylistEdit) Validate() error {
	switch {
	case e.Name != nil && (strings.TrimSpace(*e.Name) == "" || len(*e.Name) > 200):
		return errors.New("name must be 1 to 200 characters")
	case e.Description != nil && len(*e.Description) > 2000:
		return errors.New("description must be 2000 characters at most")
	}
	return nil
}

func (s *Store) CreatePlaylist(ctx context.Context, userID uuid.UUID, name, description string) (uuid.UUID, error) {
	id := newID()
	_, err := s.pool.Exec(ctx, `insert into playlists (id, owner_id, name, description, kind) values ($1, $2, $3, nullif($4, ''), 'standard')`,
		id, userID, strings.TrimSpace(name), description)
	return id, err
}

func (s *Store) EditPlaylist(ctx context.Context, id uuid.UUID, e PlaylistEdit) error {
	tag, err := s.pool.Exec(ctx, `update playlists set name = coalesce($2, name),
		description = case when $3::boolean then nullif($4, '') else description end, updated_at = now() where id = $1`,
		id, e.Name, e.Description != nil, deref(e.Description))
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) DeletePlaylist(ctx context.Context, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `delete from playlists where id = $1`, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) AddToPlaylist(ctx context.Context, playlistID, userID uuid.UUID, trackIDs []uuid.UUID) (int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	if err := lockPlaylist(ctx, tx, playlistID); err != nil {
		return 0, err
	}
	items, err := newItemAppender(ctx, tx, playlistID)
	if err != nil {
		return 0, err
	}
	added := 0
	for _, id := range trackIDs {
		ok, err := items.add(ctx, tx, id, time.Time{})
		if isForeignKey(err) {
			return added, fmt.Errorf("track %s: %w", id, ErrNotFound)
		}
		if err != nil {
			return added, err
		}
		if ok {
			added++
			if _, err := tx.Exec(ctx, `update playlist_items set added_by = $3 where playlist_id = $1 and track_id = $2`, playlistID, id, userID); err != nil {
				return added, err
			}
		}
	}
	if _, err := tx.Exec(ctx, `update playlists set updated_at = now() where id = $1`, playlistID); err != nil {
		return added, err
	}
	return added, tx.Commit(ctx)
}

func lockPlaylist(ctx context.Context, tx pgx.Tx, id uuid.UUID) error {
	var found uuid.UUID
	err := tx.QueryRow(ctx, `select id from playlists where id = $1 for update`, id).Scan(&found)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

type playlistItem struct {
	trackID uuid.UUID
	addedBy *uuid.UUID
	note    *string
	side    *string
	addedAt time.Time
}

func rewriteItems(ctx context.Context, tx pgx.Tx, playlistID uuid.UUID, items []playlistItem) error {
	if _, err := tx.Exec(ctx, `delete from playlist_items where playlist_id = $1`, playlistID); err != nil {
		return err
	}
	for i, it := range items {
		if _, err := tx.Exec(ctx, `insert into playlist_items (playlist_id, position, track_id, added_by, note, side, added_at)
			values ($1, $2, $3, $4, $5, $6, $7)`, playlistID, i, it.trackID, it.addedBy, it.note, it.side, it.addedAt); err != nil {
			return err
		}
	}
	_, err := tx.Exec(ctx, `update playlists set updated_at = now() where id = $1`, playlistID)
	return err
}

func currentItems(ctx context.Context, tx pgx.Tx, playlistID uuid.UUID) ([]playlistItem, error) {
	rows, err := tx.Query(ctx, `select track_id, added_by, note, side, added_at from playlist_items where playlist_id = $1 order by position`, playlistID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (playlistItem, error) {
		var it playlistItem
		return it, row.Scan(&it.trackID, &it.addedBy, &it.note, &it.side, &it.addedAt)
	})
}

func (s *Store) RemoveFromPlaylist(ctx context.Context, playlistID, trackID uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := lockPlaylist(ctx, tx, playlistID); err != nil {
		return err
	}
	items, err := currentItems(ctx, tx, playlistID)
	if err != nil {
		return err
	}
	kept := items[:0]
	for _, it := range items {
		if it.trackID != trackID {
			kept = append(kept, it)
		}
	}
	if len(kept) == len(items) {
		return ErrNotFound
	}
	if err := rewriteItems(ctx, tx, playlistID, kept); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

var ErrNotPermutation = errors.New("track_ids must list every track of the playlist once")

func (s *Store) ReorderPlaylist(ctx context.Context, playlistID uuid.UUID, trackIDs []uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := lockPlaylist(ctx, tx, playlistID); err != nil {
		return err
	}
	items, err := currentItems(ctx, tx, playlistID)
	if err != nil {
		return err
	}
	byTrack := make(map[uuid.UUID]playlistItem, len(items))
	for _, it := range items {
		byTrack[it.trackID] = it
	}
	if len(trackIDs) != len(items) {
		return ErrNotPermutation
	}
	ordered := make([]playlistItem, 0, len(items))
	for _, id := range trackIDs {
		it, ok := byTrack[id]
		if !ok {
			return ErrNotPermutation
		}
		delete(byTrack, id)
		ordered = append(ordered, it)
	}
	if err := rewriteItems(ctx, tx, playlistID, ordered); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
