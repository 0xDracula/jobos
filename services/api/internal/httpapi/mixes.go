package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jobbos/api/internal/store"
)

type RecsStore interface {
	Mixes(ctx context.Context, userID uuid.UUID) ([]store.Mix, error)
	MixGeneratedAt(ctx context.Context, userID uuid.UUID, kind string) (time.Time, error)
	MixSize(ctx context.Context, userID uuid.UUID, kind string) (int, error)
	GenerateMixes(ctx context.Context, userID uuid.UUID, kinds []string, now time.Time, loc *time.Location) (map[string]int, error)
	MixPalette(ctx context.Context, ids []uuid.UUID) ([]string, error)
	SimilarTracks(ctx context.Context, userID, trackID uuid.UUID, limit int) ([]store.SimilarTrack, error)
	Releases(ctx context.Context, userID uuid.UUID, now time.Time) ([]store.Release, error)
	ReleaseTracks(ctx context.Context, deezerID string) ([]uuid.UUID, error)
	ReleasesCheckedAt(ctx context.Context) (time.Time, error)
	EnqueueReleases(ctx context.Context, users []uuid.UUID, now time.Time) (bool, error)
	EnqueueCandidates(ctx context.Context, userID uuid.UUID, now time.Time) (bool, error)
	CandidatesStatus(ctx context.Context, userID uuid.UUID) (*store.CandidatesStatus, error)
	BackfillModels(ctx context.Context) (int, error)
	ModelStatus(ctx context.Context) (store.ModelStatus, error)
	TasteGroups(ctx context.Context, userID uuid.UUID) ([]store.TasteGroupView, error)
	RecMetrics(ctx context.Context, userID uuid.UUID, since time.Time) (store.RecMetrics, error)
	LoadEmbeddings(ctx context.Context) (*store.Embeddings, error)
}

func (a *api) registerMixRoutes(r chi.Router) {
	r.Get("/mixes", a.mixes)
	r.Get("/mixes/{kind}", a.mix)
	r.Get("/mixes/{kind}/cover.png", a.mixCover)
	r.Get("/tracks/{id}/similar", a.similarTracks)
	r.Get("/releases", a.releases)
	r.Post("/releases/{id}/tracks", a.releaseTracks)
}

func (a *api) registerMixAdminRoutes(r chi.Router) {
	r.Get("/recommendations", a.adminRecommendations)
	r.Post("/recommendations/refresh", a.refreshRecommendations)
	r.Post("/analysis/models/backfill", a.backfillModels)
}

var mixTitles = map[string]string{
	store.MixDaily:      "Daily mix",
	store.MixYourSong:   "More like our song",
	store.MixMorning:    "Morning mix",
	store.MixAfternoon:  "Afternoon mix",
	store.MixEvening:    "Evening mix",
	store.MixLateNight:  "Late-night mix",
	store.MixHappy:      "Happy mix",
	store.MixCalm:       "Calm mix",
	store.MixSad:        "Sad mix",
	store.MixEnergetic:  "Energetic mix",
	store.MixRediscover: "Rediscover",
}

type mixSummary struct {
	Kind        string    `json:"kind"`
	Title       string    `json:"title"`
	Count       int       `json:"count"`
	GeneratedAt time.Time `json:"generated_at"`
	CoverURL    string    `json:"cover_url"`
	Current     bool      `json:"current,omitempty"`
	Artists     []string  `json:"artists"`
}

func coverURL(kind string, at time.Time) string {
	return fmt.Sprintf("/api/mixes/%s/cover.png?v=%d", kind, at.Unix())
}

func (a *api) mixes(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	list, err := a.Store.Mixes(ctx, uid(r))
	if err != nil {
		a.serverError(w, "mixes", err)
		return
	}
	period := store.PeriodOf(time.Now().In(a.homeTZ()).Hour())
	order := map[string]int{}
	for i, k := range store.AllMixes {
		order[k] = i
	}
	out := make([]mixSummary, 0, len(list))
	for _, m := range list {
		if len(m.Items) == 0 {
			continue
		}
		ids := make([]uuid.UUID, 0, 4)
		for _, it := range m.Items[:min(4, len(m.Items))] {
			ids = append(ids, it.TrackID)
		}
		views, err := a.Store.TracksByID(ctx, ids)
		if err != nil {
			a.serverError(w, "mix tracks", err)
			return
		}
		var artists []string
		for _, v := range views {
			for _, ar := range v.Artists {
				if !slices.Contains(artists, ar) {
					artists = append(artists, ar)
				}
			}
		}
		out = append(out, mixSummary{Kind: m.Kind, Title: mixTitles[m.Kind], Count: len(m.Items), GeneratedAt: m.GeneratedAt,
			CoverURL: coverURL(m.Kind, m.GeneratedAt), Current: m.Kind == period, Artists: artists[:min(3, len(artists))]})
	}
	slices.SortStableFunc(out, func(x, y mixSummary) int { return order[x.Kind] - order[y.Kind] })
	writeJSON(w, http.StatusOK, map[string]any{"mixes": out})
}

type mixTrack struct {
	store.TrackView
	Reason store.Reason `json:"reason"`
	New    bool         `json:"new"`
}

func (a *api) mix(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	kind := chi.URLParam(r, "kind")
	list, err := a.Store.Mixes(ctx, uid(r))
	if err != nil {
		a.serverError(w, "mixes", err)
		return
	}
	for _, m := range list {
		if m.Kind != kind || len(m.Items) == 0 {
			continue
		}
		ids := make([]uuid.UUID, len(m.Items))
		byID := map[uuid.UUID]store.MixItem{}
		for i, it := range m.Items {
			ids[i] = it.TrackID
			byID[it.TrackID] = it
		}
		views, err := a.Store.TracksByID(ctx, ids)
		if err != nil {
			a.serverError(w, "mix tracks", err)
			return
		}
		tracks := make([]mixTrack, 0, len(views))
		for _, v := range views {
			it := byID[v.ID]
			tracks = append(tracks, mixTrack{TrackView: v, Reason: it.Reason, New: it.New})
		}
		writeJSON(w, http.StatusOK, map[string]any{"kind": m.Kind, "title": mixTitles[m.Kind], "generated_at": m.GeneratedAt,
			"cover_url": coverURL(m.Kind, m.GeneratedAt), "tracks": tracks})
		return
	}
	writeError(w, http.StatusNotFound, "no such mix")
}

var coverCache = struct {
	sync.Mutex
	m map[string][]byte
}{m: map[string][]byte{}}

func (a *api) mixCover(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	kind := chi.URLParam(r, "kind")
	if _, ok := mixTitles[kind]; !ok {
		writeError(w, http.StatusNotFound, "no such mix")
		return
	}
	var ids []uuid.UUID
	if list, err := a.Store.Mixes(ctx, uid(r)); err == nil {
		for _, m := range list {
			if m.Kind == kind {
				for _, it := range m.Items {
					ids = append(ids, it.TrackID)
				}
			}
		}
	}
	palette, err := a.Store.MixPalette(ctx, ids)
	if err != nil {
		a.serverError(w, "mix palette", err)
		return
	}
	key := fmt.Sprintf("%s|%v|%d", kind, palette, coverStyleVersion)
	etag := fmt.Sprintf(`"%x"`, fnvHash(key))
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	coverCache.Lock()
	png, ok := coverCache.m[key]
	coverCache.Unlock()
	if !ok {
		png, err = RenderMixCover(kind, palette)
		if err != nil {
			a.serverError(w, "render cover", err)
			return
		}
		coverCache.Lock()
		if len(coverCache.m) > 256 {
			coverCache.m = map[string][]byte{}
		}
		coverCache.m[key] = png
		coverCache.Unlock()
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, max-age=86400")
	_, _ = w.Write(png)
}

func (a *api) similarTracks(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid track id")
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 30 {
		limit = 12
	}
	near, err := a.Store.SimilarTracks(r.Context(), uid(r), id, limit)
	if err != nil {
		a.serverError(w, "similar tracks", err)
		return
	}
	ids := make([]uuid.UUID, len(near))
	for i, n := range near {
		ids[i] = n.ID
	}
	tracks, err := a.Store.TracksByID(r.Context(), ids)
	if err != nil {
		a.serverError(w, "similar tracks", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tracks": tracks})
}

func (a *api) releases(w http.ResponseWriter, r *http.Request) {
	list, err := a.Store.Releases(r.Context(), uid(r), time.Now())
	if err != nil {
		a.serverError(w, "releases", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"releases": list})
}

func (a *api) releaseTracks(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	ids, err := a.Store.ReleaseTracks(ctx, chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "no such release")
		return
	}
	if err != nil {
		a.serverError(w, "release tracks", err)
		return
	}
	if len(ids) > 0 {
		if err := a.Store.EnqueueMatch(ctx, ids[0], store.PriorityInteractive); err != nil && !errors.Is(err, store.ErrNotFound) {
			a.Log.Warn("match release track", "err", err)
		}
	}
	tracks, err := a.Store.TracksByID(ctx, ids)
	if err != nil {
		a.serverError(w, "release tracks", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tracks": tracks})
}

func (a *api) backfillModels(w http.ResponseWriter, r *http.Request) {
	n, err := a.Store.BackfillModels(r.Context())
	if err != nil {
		a.serverError(w, "backfill models", err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]int{"queued": n})
}

type recUserStatus struct {
	UserID     uuid.UUID               `json:"user_id"`
	Candidates *store.CandidatesStatus `json:"candidates"`
	Groups     []store.TasteGroupView  `json:"groups"`
	Mixes      []mixSummary            `json:"mixes"`
	Metrics    store.RecMetrics        `json:"metrics"`
}

func (a *api) adminRecommendations(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	models, err := a.Store.ModelStatus(ctx)
	if err != nil {
		a.serverError(w, "model status", err)
		return
	}
	users, err := a.Store.Members(ctx)
	if err != nil {
		a.serverError(w, "members", err)
		return
	}
	checked, err := a.Store.ReleasesCheckedAt(ctx)
	if err != nil {
		a.serverError(w, "releases", err)
		return
	}
	out := make([]recUserStatus, 0, len(users))
	for _, u := range users {
		st := recUserStatus{UserID: u.ID}
		if st.Candidates, err = a.Store.CandidatesStatus(ctx, u.ID); err != nil {
			a.serverError(w, "candidates status", err)
			return
		}
		if st.Groups, err = a.Store.TasteGroups(ctx, u.ID); err != nil {
			a.serverError(w, "taste groups", err)
			return
		}
		if st.Metrics, err = a.Store.RecMetrics(ctx, u.ID, time.Now().Add(-30*24*time.Hour)); err != nil {
			a.serverError(w, "metrics", err)
			return
		}
		mixes, err := a.Store.Mixes(ctx, u.ID)
		if err != nil {
			a.serverError(w, "mixes", err)
			return
		}
		for _, m := range mixes {
			st.Mixes = append(st.Mixes, mixSummary{Kind: m.Kind, Title: mixTitles[m.Kind], Count: len(m.Items), GeneratedAt: m.GeneratedAt})
		}
		slices.SortStableFunc(st.Mixes, func(x, y mixSummary) int {
			return slices.Index(store.AllMixes, x.Kind) - slices.Index(store.AllMixes, y.Kind)
		})
		out = append(out, st)
	}
	var releasesChecked *time.Time
	if !checked.IsZero() {
		releasesChecked = &checked
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": models, "users": out, "releases_checked_at": releasesChecked})
}

func (a *api) refreshRecommendations(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	users, err := a.Store.Members(ctx)
	if err != nil {
		a.serverError(w, "members", err)
		return
	}
	now := time.Now()
	result := map[string]any{}
	for _, u := range users {
		queued, err := a.Store.EnqueueCandidates(ctx, u.ID, now)
		if err != nil {
			a.serverError(w, "enqueue candidates", err)
			return
		}
		counts, err := a.Store.GenerateMixes(ctx, u.ID, store.AllMixes, now, a.homeTZ())
		if err != nil {
			a.serverError(w, "generate mixes", err)
			return
		}
		result[u.ID.String()] = map[string]any{"candidates_queued": queued, "mixes": counts}
	}
	writeJSON(w, http.StatusOK, result)
}

var lastBackfill struct {
	sync.Mutex
	at time.Time
}

func backfillModels(ctx context.Context, d Deps, now time.Time) {
	lastBackfill.Lock()
	due := now.Sub(lastBackfill.at) >= time.Hour
	if due {
		lastBackfill.at = now
	}
	lastBackfill.Unlock()
	if !due {
		return
	}
	n, err := d.Store.BackfillModels(ctx)
	if err != nil {
		d.Log.Warn("recommendations: backfill models", "err", err)
	} else if n > 0 {
		d.Log.Info("model analysis queued", "files", n)
	}
}

type recsState struct {
	CandidatesRequested time.Time `json:"candidates_requested"`
	Analyzed            float64   `json:"analyzed"`
	ReleasesNotified    time.Time `json:"releases_notified"`
}

func RefreshRecommendations(ctx context.Context, d Deps, now time.Time) {
	if d.Store == nil {
		return
	}
	a := &api{Deps: d}
	loc := a.homeTZ()
	local := now.In(loc)
	day := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	backfillModels(ctx, d, now)
	users, err := d.Store.Members(ctx)
	if err != nil {
		d.Log.Warn("recommendations: members", "err", err)
		return
	}
	models, err := d.Store.ModelStatus(ctx)
	if err != nil {
		d.Log.Warn("recommendations: model status", "err", err)
		return
	}
	analyzed := 0.0
	if models.Files > 0 {
		analyzed = float64(models.Analyzed) / float64(models.Files)
	}
	for _, u := range users {
		var st recsState
		if raw, err := d.Store.UserSetting(ctx, u.ID, "recs.state"); err == nil && raw != nil {
			_ = json.Unmarshal(raw, &st)
		}
		changed := false
		cands, err := d.Store.CandidatesStatus(ctx, u.ID)
		if err != nil {
			d.Log.Warn("recommendations: candidates status", "err", err)
			continue
		}
		if local.Hour() >= 5 && st.CandidatesRequested.Before(day.Add(5*time.Hour)) || st.CandidatesRequested.IsZero() {
			if _, err := d.Store.EnqueueCandidates(ctx, u.ID, now); err != nil {
				d.Log.Warn("recommendations: enqueue candidates", "user", u.Username, "err", err)
			} else {
				st.CandidatesRequested, changed = now, true
			}
		}
		daily, err := d.Store.MixGeneratedAt(ctx, u.ID, store.MixDaily)
		if err != nil {
			d.Log.Warn("recommendations: daily mix", "err", err)
			continue
		}
		rebuild := daily.IsZero() ||
			local.Hour() >= 6 && daily.Before(day.Add(6*time.Hour)) ||
			cands != nil && cands.RefreshedAt.After(daily) && now.Sub(daily) < 3*time.Hour ||
			analyzed-st.Analyzed >= 0.3
		if rebuild {
			counts, err := d.Store.GenerateMixes(ctx, u.ID, store.DailyMixes, now, loc)
			if err != nil {
				d.Log.Warn("recommendations: daily mixes", "user", u.Username, "err", err)
			} else {
				d.Log.Info("daily mixes", "user", u.Username, "songs", counts)
				st.Analyzed, changed = analyzed, true
			}
		}
		weekly, err := d.Store.MixGeneratedAt(ctx, u.ID, store.MixYourSong)
		empty, _ := d.Store.MixSize(ctx, u.ID, store.MixYourSong)
		if err == nil && (weekly.IsZero() || now.Sub(weekly) >= 7*24*time.Hour && local.Hour() >= 6 || rebuild && (empty == 0 || now.Sub(weekly) > 24*time.Hour)) {
			if counts, err := d.Store.GenerateMixes(ctx, u.ID, store.WeeklyMixes, now, loc); err != nil {
				d.Log.Warn("recommendations: weekly mixes", "user", u.Username, "err", err)
			} else {
				d.Log.Info("weekly mixes", "user", u.Username, "songs", counts)
			}
		}
		if releases, err := d.Store.Releases(ctx, u.ID, now); err == nil {
			var fresh []store.Release
			for _, rel := range releases {
				if rel.FoundAt.After(st.ReleasesNotified) && !st.ReleasesNotified.IsZero() {
					fresh = append(fresh, rel)
				}
			}
			if st.ReleasesNotified.IsZero() || len(fresh) > 0 {
				if len(fresh) == 1 {
					a.notify(u.ID, "releases", "New release", fresh[0].Artist+" · "+fresh[0].Title, "/discover/")
				} else if len(fresh) > 1 {
					a.notify(u.ID, "releases", "New releases", fmt.Sprintf("%d new releases", len(fresh)), "/discover/")
				}
				st.ReleasesNotified, changed = now, true
			}
		}
		if changed {
			if raw, err := json.Marshal(st); err == nil {
				if err := d.Store.SetSetting(ctx, u.ID, "recs.state", raw); err != nil {
					d.Log.Warn("recommendations: save state", "err", err)
				}
			}
		}
	}
	checked, err := d.Store.ReleasesCheckedAt(ctx)
	if err == nil && now.Sub(checked) >= 7*24*time.Hour && local.Hour() >= 5 {
		ids := make([]uuid.UUID, len(users))
		for i, u := range users {
			ids[i] = u.ID
		}
		var requested time.Time
		if raw, err := d.Store.AppSetting(ctx, "recs.releases_requested_at"); err == nil && raw != nil {
			_ = json.Unmarshal(raw, &requested)
		}
		if now.Sub(requested) >= 24*time.Hour {
			if _, err := d.Store.EnqueueReleases(ctx, ids, now); err != nil {
				d.Log.Warn("recommendations: enqueue releases", "err", err)
			} else if raw, err := json.Marshal(now); err == nil {
				_ = d.Store.SetAppSetting(ctx, "recs.releases_requested_at", raw)
			}
		}
	}
}
