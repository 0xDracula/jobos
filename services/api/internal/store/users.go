package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type User struct {
	ID          uuid.UUID `json:"id"`
	Username    string    `json:"username"`
	DisplayName string    `json:"display_name"`
	Role        string    `json:"role"`
}

func (s *Store) EnsureAdmin(ctx context.Context, username, displayName string) (*User, error) {
	var u User
	err := s.pool.QueryRow(ctx, `select id, username, display_name, role from users where role = 'admin' order by created_at limit 1`).
		Scan(&u.ID, &u.Username, &u.DisplayName, &u.Role)
	if err == nil || !errors.Is(err, pgx.ErrNoRows) {
		return &u, err
	}
	if username == "" {
		return nil, errors.New("ADMIN_USERNAME is not set and no admin exists")
	}
	if displayName == "" {
		displayName = username
	}
	err = s.pool.QueryRow(ctx, `insert into users (id, role, username, display_name) values ($1, 'admin', $2, $3)
		returning id, username, display_name, role`, newID(), username, displayName).Scan(&u.ID, &u.Username, &u.DisplayName, &u.Role)
	return &u, err
}

func (s *Store) User(ctx context.Context, id uuid.UUID) (*User, error) {
	var u User
	err := s.pool.QueryRow(ctx, `select id, username, display_name, role from users where id = $1`, id).
		Scan(&u.ID, &u.Username, &u.DisplayName, &u.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &u, err
}

func (s *Store) RegisterDevice(ctx context.Context, userID uuid.UUID, id *uuid.UUID, name, platform string) (uuid.UUID, error) {
	if id != nil {
		tag, err := s.pool.Exec(ctx, `update devices set name = $3, platform = nullif($4, ''), last_seen_at = now()
			where id = $1 and user_id = $2`, *id, userID, name, platform)
		if err != nil || tag.RowsAffected() == 1 {
			return *id, err
		}
	}
	newDevice := newID()
	_, err := s.pool.Exec(ctx, `insert into devices (id, user_id, name, platform) values ($1, $2, $3, nullif($4, ''))`,
		newDevice, userID, name, platform)
	return newDevice, err
}

var settingKeyRE = regexp.MustCompile(`^[a-z][a-z0-9_.]{0,63}$`)

func (s *Store) Settings(ctx context.Context, userID uuid.UUID) (map[string]json.RawMessage, error) {
	rows, err := s.pool.Query(ctx, `select key, value from user_settings where user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]json.RawMessage{}
	for rows.Next() {
		var k string
		var v []byte
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

func (s *Store) SetSetting(ctx context.Context, userID uuid.UUID, key string, value json.RawMessage) error {
	if !settingKeyRE.MatchString(key) {
		return fmt.Errorf("invalid setting key %q", key)
	}
	if len(value) == 0 || len(value) > 16<<10 || !json.Valid(value) {
		return errors.New("setting value must be JSON of 16 KB at most")
	}
	_, err := s.pool.Exec(ctx, `insert into user_settings (user_id, key, value, updated_at) values ($1, $2, $3, now())
		on conflict (user_id, key) do update set value = excluded.value, updated_at = now()`, userID, key, []byte(value))
	return err
}
