package store

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type StartArtist struct {
	ID    string      `json:"id"`
	Name  string      `json:"name"`
	Image *string     `json:"image"`
	Songs []StartSong `json:"songs"`
}

type StartSong struct {
	VideoID string   `json:"video_id"`
	Title   string   `json:"title"`
	Artists []string `json:"artists"`
}

const StartPicksKey = "start.artists"

func (s *Store) HasHistory(ctx context.Context, userID uuid.UUID) (bool, error) {
	var has bool
	err := s.pool.QueryRow(ctx, `select exists (select 1 from listening_events where user_id = $1)
		or exists (select 1 from likes where user_id = $1)`, userID).Scan(&has)
	return has, err
}

func (s *Store) startSeeds(ctx context.Context, userID uuid.UUID, p *CandidatesPayload) error {
	var raw []byte
	err := s.pool.QueryRow(ctx, `select value from user_settings where user_id = $1 and key = $2`, userID, StartPicksKey).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	var picks []StartArtist
	if json.Unmarshal(raw, &picks) != nil {
		return nil
	}
	for round := 0; len(p.Tracks) < SeedTracks; round++ {
		added := false
		for _, a := range picks {
			if round < len(a.Songs) && len(p.Tracks) < SeedTracks {
				song := a.Songs[round]
				p.Tracks = append(p.Tracks, seedTrack{Title: song.Title, Artists: song.Artists, VideoID: song.VideoID})
				added = true
			}
		}
		if !added {
			break
		}
	}
	for _, a := range picks {
		if len(p.Artists) >= SeedArtists {
			break
		}
		p.Artists = append(p.Artists, seedArtist{Name: a.Name})
	}
	return nil
}
