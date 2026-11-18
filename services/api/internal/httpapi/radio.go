package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"math/rand/v2"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jobbos/api/internal/store"
	"jobbos/api/internal/world"
)

func (a *api) registerRadioRoutes(r chi.Router) {
	r.Post("/radio", a.radio)
	r.Get("/mixes/weather", a.weatherMix)
}

var moods = map[string][2]float64{
	"calm":       {0.3, 0.5},
	"upbeat":     {0.75, 0.75},
	"melancholy": {0.35, 0.2},
	"late_night": {0.35, 0.45},
}

type radioRequest struct {
	Seed struct {
		Type string      `json:"type"`
		ID   *uuid.UUID  `json:"id"`
		Mood string      `json:"mood"`
		IDs  []uuid.UUID `json:"ids"`
	} `json:"seed"`
	Exclude []uuid.UUID `json:"exclude"`
	Skipped []uuid.UUID `json:"skipped"`
	Liked   []uuid.UUID `json:"liked"`
	Recent  []uuid.UUID `json:"recent"`
	Limit   int         `json:"limit"`
	Session string      `json:"session"`
}

func (a *api) seedFor(ctx context.Context, in radioRequest, cands []store.MixTrack) (store.Seed, error) {
	byID := make(map[uuid.UUID]store.MixTrack, len(cands))
	for _, t := range cands {
		byID[t.ID] = t
	}
	var from []store.MixTrack
	switch in.Seed.Type {
	case "mood":
		target, ok := moods[in.Seed.Mood]
		if !ok {
			return store.Seed{}, errors.New("unknown mood")
		}
		return store.Seed{Artists: map[uuid.UUID]float64{}, Tags: map[string]float64{}, Energy: &target[0], Valence: &target[1]}, nil
	case "track":
		if in.Seed.ID == nil {
			return store.Seed{}, errors.New("seed id is required")
		}
		if t, ok := byID[*in.Seed.ID]; ok {
			from = []store.MixTrack{t}
		}
	case "artist":
		if in.Seed.ID == nil {
			return store.Seed{}, errors.New("seed id is required")
		}
		for _, t := range cands {
			for _, ar := range t.ArtistIDs {
				if ar == *in.Seed.ID {
					from = append(from, t)
				}
			}
		}
		if len(from) == 0 {
			seed := store.Seed{Artists: map[uuid.UUID]float64{*in.Seed.ID: 1}, Tags: map[string]float64{}}
			return seed, nil
		}
	case "playlist":
		if in.Seed.ID == nil {
			return store.Seed{}, errors.New("seed id is required")
		}
		ids, err := a.Store.PlaylistTrackIDs(ctx, *in.Seed.ID)
		if err != nil {
			return store.Seed{}, err
		}
		for _, id := range ids {
			if t, ok := byID[id]; ok {
				from = append(from, t)
			}
		}
	case "recent":
		for _, id := range in.Seed.IDs {
			if t, ok := byID[id]; ok {
				from = append(from, t)
			}
		}
	default:
		return store.Seed{}, errors.New("seed type must be track, artist, playlist, mood or recent")
	}
	var artists []uuid.UUID
	for _, t := range from {
		artists = append(artists, t.ArtistIDs...)
	}
	related, err := a.Store.RelatedArtists(ctx, artists)
	if err != nil {
		return store.Seed{}, err
	}
	seed := store.SeedFrom(from, related)
	if in.Seed.Type == "artist" {
		seed.Artists[*in.Seed.ID] = 1
	}
	if emb := a.embeddings(ctx); emb != nil && len(from) > 0 {
		ids := make([]uuid.UUID, len(from))
		for i, t := range from {
			ids[i] = t.ID
		}
		seed.Sound = store.SoundCloseness(emb, ids, cands)
	}
	return seed, nil
}

var embCache struct {
	sync.Mutex
	at  time.Time
	emb *store.Embeddings
}

func (a *api) embeddings(ctx context.Context) *store.Embeddings {
	embCache.Lock()
	defer embCache.Unlock()
	if embCache.emb != nil && time.Since(embCache.at) < 10*time.Minute {
		return embCache.emb
	}
	emb, err := a.Store.LoadEmbeddings(ctx)
	if err != nil {
		a.Log.Warn("radio embeddings", "err", err)
		return embCache.emb
	}
	embCache.at, embCache.emb = time.Now(), emb
	return emb
}

func (a *api) radio(w http.ResponseWriter, r *http.Request) {
	var in radioRequest
	if !readJSON(w, r, &in) {
		return
	}
	if in.Limit <= 0 || in.Limit > 50 {
		in.Limit = 10
	}
	ctx := r.Context()
	cands, err := a.Store.MixCandidates(ctx, uid(r))
	if err != nil {
		a.serverError(w, "radio candidates", err)
		return
	}
	seed, err := a.seedFor(ctx, in, cands)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	artistsOf := make(map[uuid.UUID][]uuid.UUID, len(cands))
	for _, t := range cands {
		artistsOf[t.ID] = t.ArtistIDs
	}
	steer := store.Steer{Skipped: map[uuid.UUID]int{}, Liked: map[uuid.UUID]int{}}
	for _, id := range in.Skipped {
		for _, ar := range artistsOf[id] {
			steer.Skipped[ar]++
		}
	}
	for _, id := range in.Liked {
		for _, ar := range artistsOf[id] {
			steer.Liked[ar]++
		}
	}
	exclude := make(map[uuid.UUID]bool, len(in.Exclude))
	for _, id := range in.Exclude {
		exclude[id] = true
	}
	if in.Seed.Type == "track" && in.Seed.ID != nil {
		exclude[*in.Seed.ID] = true
	}
	var recent []uuid.UUID
	for _, id := range in.Recent {
		if as := artistsOf[id]; len(as) > 0 {
			recent = append(recent, as[0])
		}
	}
	h := fnv.New64a()
	_, _ = fmt.Fprintf(h, "%s:%d", in.Session, len(in.Exclude))
	rng := rand.New(rand.NewPCG(h.Sum64(), uint64(len(cands))))
	ids := store.Pick(cands, seed, steer, exclude, recent, in.Limit, rng)
	tracks, err := a.Store.TracksByID(ctx, ids)
	if err != nil {
		a.serverError(w, "radio tracks", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tracks": tracks})
}

func weatherTarget(wx *world.Weather) (key, mood string, energy, valence float64) {
	warm := wx.TemperatureC >= 20
	switch wx.Condition {
	case world.Rain, world.Drizzle, world.Thunderstorm, world.Snow, world.Fog:
		return wx.Condition, "mellow", 0.3, 0.4
	case world.Clear:
		if warm && wx.IsDay {
			return "clear-warm-day", "upbeat", 0.75, 0.75
		}
		if wx.IsDay {
			return "clear-day", "bright", 0.55, 0.65
		}
		return "clear-night", "soft", 0.4, 0.55
	default:
		return "clouds", "soft", 0.45, 0.45
	}
}

type weatherMixCache struct {
	Key string      `json:"key"`
	At  time.Time   `json:"at"`
	IDs []uuid.UUID `json:"ids"`
}

const weatherMixSize = 20

func (a *api) weatherMix(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	settings, err := a.Store.Settings(ctx, uid(r))
	if err != nil {
		a.serverError(w, "settings", err)
		return
	}
	city := decodeCity(settings[settingManualCity])
	if city == nil {
		city = decodeCity(settings[settingDetectedCity])
	}
	if city == nil || a.World == nil {
		writeError(w, http.StatusNotFound, "no city")
		return
	}
	wx, err := a.World.Weather(ctx, city.Lat, city.Lon)
	if err != nil {
		writeError(w, http.StatusBadGateway, "weather unavailable")
		return
	}
	key, mood, energy, valence := weatherTarget(wx)
	var cached weatherMixCache
	if raw, ok := settings["mix.weather"]; ok {
		_ = json.Unmarshal(raw, &cached)
	}
	cands, err := a.Store.MixCandidates(ctx, uid(r))
	if err != nil {
		a.serverError(w, "mix candidates", err)
		return
	}
	allowed := make(map[uuid.UUID]bool, len(cands))
	for _, t := range cands {
		allowed[t.ID] = true
	}
	ids := make([]uuid.UUID, 0, len(cached.IDs))
	for _, id := range cached.IDs {
		if allowed[id] {
			ids = append(ids, id)
		}
	}
	if len(ids) < weatherMixSize/2 || (cached.Key != key && time.Since(cached.At) >= time.Hour) {
		analyzed := make([]store.MixTrack, 0, len(cands))
		for _, t := range cands {
			if t.Energy != nil && t.Valence != nil {
				analyzed = append(analyzed, t)
			}
		}
		if len(analyzed) >= weatherMixSize {
			cands = analyzed
		}
		seed := store.Seed{Artists: map[uuid.UUID]float64{}, Tags: map[string]float64{}, Energy: &energy, Valence: &valence}
		day := time.Now().Format("2006-01-02")
		h := fnv.New64a()
		_, _ = fmt.Fprintf(h, "%s:%s:%s", uid(r), key, day)
		rng := rand.New(rand.NewPCG(h.Sum64(), 7))
		ids = store.Pick(cands, seed, store.Steer{}, nil, nil, weatherMixSize, rng)
		cached = weatherMixCache{Key: key, At: time.Now(), IDs: ids}
		if raw, err := json.Marshal(cached); err == nil {
			if err := a.Store.SetSetting(ctx, uid(r), "mix.weather", raw); err != nil {
				a.Log.Warn("save weather mix", "err", err)
			}
		}
	}
	tracks, err := a.Store.TracksByID(ctx, ids)
	if err != nil {
		a.serverError(w, "mix tracks", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"weather":      map[string]any{"condition": wx.Condition, "temperature_c": wx.TemperatureC, "is_day": wx.IsDay, "city": city.Name},
		"mood":         mood,
		"generated_at": cached.At,
		"tracks":       tracks,
	})
}
