package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jobbos/api/internal/realtime"
	"jobbos/api/internal/store"
)

func (a *api) registerGiftRoutes(r chi.Router) {
	r.Put("/me/avatar", a.setAvatar)
	r.Get("/favorites", a.favorites)
	r.Put("/favorites", a.setFavorites)
	r.Get("/stars", a.stars)
	r.Get("/room/config", a.roomConfig)
	r.Get("/our-song", a.ourSong)

	r.Get("/tracks/{id}/notes", a.trackNotes)
	r.Post("/tracks/{id}/notes", a.createSongNote)
	r.Get("/song-notes", a.allSongNotes)
	r.Patch("/song-notes/{id}", a.updateSongNote)
	r.Delete("/song-notes/{id}", a.deleteSongNote)

	r.Get("/scrapbook", a.scrapbook)
	r.Post("/scrapbook", a.addClipping)
	r.Delete("/scrapbook/{id}", a.deleteClipping)

	r.Post("/clips", a.uploadClip)
	r.Get("/clips/{id}", a.voiceClip)
	r.Get("/tracks/{id}/dedications", a.trackDedications)
	r.Post("/tracks/{id}/dedications", a.createDedication)
	r.Get("/dedications", a.allDedications)
	r.Get("/dedications/ids", a.dedicatedIDs)
	r.Delete("/dedications/{id}", a.deleteDedication)

	r.Get("/mixtapes", a.mixtapes)
	r.Post("/mixtapes", a.createMixtape)
	r.Get("/mixtapes/{id}", a.mixtape)
	r.Put("/mixtapes/{id}", a.updateMixtape)
	r.Delete("/mixtapes/{id}", a.deleteMixtape)
	r.Post("/mixtapes/{id}/send", a.sendMixtape)
	r.Post("/mixtapes/{id}/open", a.openMixtape)

	r.Get("/searches/recent", a.recentSearches)
	r.Post("/searches/recent", a.addRecentSearch)
	r.Delete("/searches/recent", a.deleteRecentSearch)
}

func (a *api) registerGiftAdminRoutes(r chi.Router) {
	r.Get("/room", a.adminRoom)
	r.Put("/room", a.setAdminRoom)
	r.Get("/her-playlist", a.herPlaylist)
	r.Put("/her-playlist", a.setHerPlaylist)
	r.Post("/playlists/{id}/spotify-cover", a.useSpotifyCover)
	r.Get("/holidays", a.adminHolidays)
	r.Put("/holidays", a.setHolidays)
	r.Put("/our-song", a.setOurSong)
}

func urlID(w http.ResponseWriter, r *http.Request, what string) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, what+" not found")
	}
	return id, err == nil
}

func (a *api) giftChanged(ctx context.Context, what ...string) {
	a.broadcast(ctx, realtime.NewEvent("gift.update", map[string]any{"lists": what}))
}

func (a *api) setAvatar(w http.ResponseWriter, r *http.Request) {
	var look map[string]any
	if !readJSON(w, r, &look) {
		return
	}
	raw, _ := json.Marshal(look)
	if len(raw) > store.MaxAvatarBytes {
		writeError(w, http.StatusBadRequest, "avatar too large")
		return
	}
	if err := a.Store.SetAvatar(r.Context(), uid(r), raw); err != nil {
		a.serverError(w, "save avatar", err)
		return
	}
	a.team.mu.Lock()
	a.team.at = time.Time{}
	a.team.mu.Unlock()
	a.broadcast(r.Context(), realtime.NewEvent("members.update", nil))
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) favorites(w http.ResponseWriter, r *http.Request) {
	lists, err := a.Store.FavoriteLists(r.Context())
	if err != nil {
		a.serverError(w, "favorites", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"lists": lists, "categories": store.FavoriteCategories})
}

func (a *api) setFavorites(w http.ResponseWriter, r *http.Request) {
	var in map[string][]string
	if !readJSON(w, r, &in) {
		return
	}
	items, err := store.CleanFavorites(in)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	list, err := a.Store.SetFavorites(r.Context(), uid(r), items)
	if err != nil {
		a.serverError(w, "save favorites", err)
		return
	}
	a.broadcast(r.Context(), realtime.NewEvent("favorites.update", map[string]any{"user_id": uid(r)}))
	writeJSON(w, http.StatusOK, list)
}

func (a *api) stars(w http.ResponseWriter, r *http.Request) {
	revealed := dateOf(swapWeek(time.Now(), a.homeTZ()))
	stars, err := a.Store.Stars(r.Context(), revealed)
	if err != nil {
		a.serverError(w, "stars", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"stars": stars})
}

type Unlockable struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Metric    string `json:"metric"`
	Threshold int    `json:"threshold"`
	Milestone string `json:"milestone,omitempty"`
}

var defaultUnlockables = []Unlockable{
	{ID: "fairy_jar", Label: "Fairy light jar", Metric: "hours", Threshold: 10},
	{ID: "moon_lamp", Label: "Moon lamp", Metric: "days", Threshold: 7},
	{ID: "hanging_plant", Label: "Hanging plant", Metric: "likes", Threshold: 25},
	{ID: "bunting", Label: "Bunting", Metric: "hours", Threshold: 50},
	{ID: "bean_bag", Label: "Bean bag", Metric: "days", Threshold: 30},
	{ID: "disco_ball", Label: "Disco ball", Metric: "hours", Threshold: 100},
	{ID: "anniversary_cake", Label: "Cake", Metric: "milestone", Threshold: 1, Milestone: "together"},
	{ID: "photo_garland", Label: "Photo garland", Metric: "milestone", Threshold: 1, Milestone: "30_days"},
	{ID: "star_lantern", Label: "Star lantern", Metric: "milestone", Threshold: 1, Milestone: "100_days"},
	{ID: "rose_bouquet", Label: "Rose bouquet", Metric: "milestone", Threshold: 1, Milestone: "1_year"},
}

type MilestoneConfig struct {
	Start string `json:"start"`
}

const defaultMilestoneStart = "2026-12-03"

type Milestone struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Date    string `json:"date"`
	Reached bool   `json:"reached"`
}

func milestoneDates(start, through, today time.Time) []Milestone {
	day := func(t time.Time) string { return t.Format("2006-01-02") }
	list := []Milestone{
		{ID: "together", Label: "Back together", Date: day(start)},
		{ID: "30_days", Label: "30 days", Date: day(start.AddDate(0, 0, 30))},
		{ID: "100_days", Label: "100 days", Date: day(start.AddDate(0, 0, 100))},
	}
	for y := 1; ; y++ {
		id, label := fmt.Sprintf("%d_years", y), fmt.Sprintf("%d years", y)
		if y == 1 {
			id, label = "1_year", "1 year"
		}
		d := start.AddDate(y, 0, 0)
		list = append(list, Milestone{ID: id, Label: label, Date: day(d)})
		if d.After(through) {
			break
		}
	}
	t := day(today)
	for i := range list {
		list[i].Reached = list[i].Date <= t
	}
	return list
}

func milestones(start, today time.Time) []Milestone {
	if today.Before(start) {
		return []Milestone{}
	}
	return milestoneDates(start, today, today)
}

func (a *api) setting(ctx context.Context, key string, into any) bool {
	raw, err := a.Store.AppSetting(ctx, key)
	if err != nil || raw == nil {
		return false
	}
	return json.Unmarshal(raw, into) == nil
}

var defaultPlantStages = []float64{0, 1, 5, 20, 60}

func validPlantStages(s []float64) bool {
	if len(s) != len(defaultPlantStages) || s[0] != 0 {
		return false
	}
	for i := 1; i < len(s); i++ {
		if s[i] <= s[i-1] || s[i] > 100000 {
			return false
		}
	}
	return true
}

func (a *api) plantStages(ctx context.Context) []float64 {
	var s []float64
	if a.setting(ctx, "plant_stages", &s) && validPlantStages(s) {
		return s
	}
	return defaultPlantStages
}

func (a *api) unlockables(ctx context.Context) []Unlockable {
	list := append([]Unlockable(nil), defaultUnlockables...)
	var thresholds map[string]int
	if a.setting(ctx, "unlock_thresholds", &thresholds) {
		for i := range list {
			if v, ok := thresholds[list[i].ID]; ok && v > 0 && list[i].Metric != "milestone" {
				list[i].Threshold = v
			}
		}
	}
	return list
}

func (a *api) milestoneStart(ctx context.Context) time.Time {
	cfg := MilestoneConfig{Start: defaultMilestoneStart}
	a.setting(ctx, "milestones", &cfg)
	start, err := time.ParseInLocation("2006-01-02", cfg.Start, a.homeTZ())
	if err != nil {
		start, _ = time.ParseInLocation("2006-01-02", defaultMilestoneStart, a.homeTZ())
	}
	return start
}

type Holiday struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Start       string     `json:"start"`
	End         string     `json:"end"`
	Decorations []string   `json:"decorations"`
	PlaylistID  *uuid.UUID `json:"playlist_id"`
}

var monthDay = regexp.MustCompile(`^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$`)

func (h *Holiday) validate() error {
	h.Name = strings.TrimSpace(h.Name)
	if h.Name == "" || utf8.RuneCountInString(h.Name) > 60 {
		return errors.New("holiday name of 1 to 60 characters")
	}
	if !monthDay.MatchString(h.Start) || !monthDay.MatchString(h.End) {
		return errors.New("holiday dates must be MM-DD")
	}
	if len(h.Decorations) > 12 {
		return errors.New("12 decorations at most")
	}
	if h.ID == "" {
		h.ID = uuid.NewString()[:8]
	}
	if h.Decorations == nil {
		h.Decorations = []string{}
	}
	return nil
}

func (a *api) holidays(ctx context.Context) []Holiday {
	var list []Holiday
	a.setting(ctx, "holidays", &list)
	if list == nil {
		list = []Holiday{}
	}
	return list
}

func (a *api) roomConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	ms := milestones(a.milestoneStart(ctx), time.Now().In(a.homeTZ()))
	reached := map[string]bool{}
	for _, m := range ms {
		reached[m.ID] = m.Reached
	}
	var unlocks []Unlockable
	for _, u := range a.unlockables(ctx) {
		if u.Metric == "milestone" && !reached[u.Milestone] {
			continue
		}
		unlocks = append(unlocks, u)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"unlockables":  unlocks,
		"plant_stages": a.plantStages(ctx),
		"milestones":   ms,
		"holidays":     append(a.occasionHolidays(ctx), a.holidays(ctx)...),
		"lamp_minutes": a.lampMinutes(ctx),
	})
}

func (a *api) adminRoom(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	writeJSON(w, http.StatusOK, map[string]any{
		"unlockables":     a.unlockables(ctx),
		"plant_stages":    a.plantStages(ctx),
		"milestone_start": a.milestoneStart(ctx).Format("2006-01-02"),
		"milestones":      milestoneDates(a.milestoneStart(ctx), time.Now().In(a.homeTZ()), time.Now().In(a.homeTZ())),
		"lamp_minutes":    a.lampMinutes(ctx),
	})
}

func (a *api) setAdminRoom(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Thresholds     map[string]int `json:"thresholds"`
		PlantStages    []float64      `json:"plant_stages"`
		MilestoneStart *string        `json:"milestone_start"`
		LampMinutes    *int           `json:"lamp_minutes"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	ctx := r.Context()
	if in.Thresholds != nil {
		known := map[string]bool{}
		for _, u := range defaultUnlockables {
			known[u.ID] = u.Metric != "milestone"
		}
		for id, v := range in.Thresholds {
			if !known[id] || v < 1 || v > 100000 {
				writeError(w, http.StatusBadRequest, "invalid threshold for "+id)
				return
			}
		}
		raw, _ := json.Marshal(in.Thresholds)
		if err := a.Store.SetAppSetting(ctx, "unlock_thresholds", raw); err != nil {
			a.serverError(w, "save thresholds", err)
			return
		}
	}
	if in.PlantStages != nil {
		if !validPlantStages(in.PlantStages) {
			writeError(w, http.StatusBadRequest, "plant stages must start at 0 and increase")
			return
		}
		raw, _ := json.Marshal(in.PlantStages)
		if err := a.Store.SetAppSetting(ctx, "plant_stages", raw); err != nil {
			a.serverError(w, "save plant stages", err)
			return
		}
	}
	if in.MilestoneStart != nil {
		if _, err := time.Parse("2006-01-02", *in.MilestoneStart); err != nil {
			writeError(w, http.StatusBadRequest, "milestone start must be YYYY-MM-DD")
			return
		}
		raw, _ := json.Marshal(MilestoneConfig{Start: *in.MilestoneStart})
		if err := a.Store.SetAppSetting(ctx, "milestones", raw); err != nil {
			a.serverError(w, "save milestones", err)
			return
		}
	}
	if in.LampMinutes != nil {
		if *in.LampMinutes < 5 || *in.LampMinutes > 24*60 {
			writeError(w, http.StatusBadRequest, "lamp minutes from 5 to 1440")
			return
		}
		raw, _ := json.Marshal(*in.LampMinutes)
		if err := a.Store.SetAppSetting(ctx, "lamp_minutes", raw); err != nil {
			a.serverError(w, "save lamp minutes", err)
			return
		}
	}
	a.broadcast(ctx, realtime.NewEvent("room.config", nil))
	a.adminRoom(w, r)
}

func (a *api) adminHolidays(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"holidays": a.holidays(r.Context())})
}

func (a *api) setHolidays(w http.ResponseWriter, r *http.Request) {
	var in []Holiday
	if !readJSON(w, r, &in) {
		return
	}
	if len(in) > 50 {
		writeError(w, http.StatusBadRequest, "50 holidays at most")
		return
	}
	for i := range in {
		if err := in[i].validate(); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	raw, _ := json.Marshal(in)
	if err := a.Store.SetAppSetting(r.Context(), "holidays", raw); err != nil {
		a.serverError(w, "save holidays", err)
		return
	}
	a.broadcast(r.Context(), realtime.NewEvent("room.config", nil))
	writeJSON(w, http.StatusOK, map[string]any{"holidays": in})
}

func (a *api) trackNotes(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "track")
	if !ok {
		return
	}
	notes, err := a.Store.SongNotes(r.Context(), &id)
	if err != nil {
		a.serverError(w, "song notes", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"notes": notes})
}

func (a *api) allSongNotes(w http.ResponseWriter, r *http.Request) {
	notes, err := a.Store.SongNotes(r.Context(), nil)
	if err != nil {
		a.serverError(w, "song notes", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"notes": notes})
}

func (a *api) createSongNote(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "track")
	if !ok {
		return
	}
	var in store.SongNoteInput
	if !readJSON(w, r, &in) {
		return
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	n, err := a.Store.CreateSongNote(r.Context(), uid(r), id, in)
	if err != nil {
		a.serverError(w, "create song note", err)
		return
	}
	a.giftChanged(r.Context(), "notes", "stars")
	writeJSON(w, http.StatusCreated, n)
}

func (a *api) updateSongNote(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "note")
	if !ok {
		return
	}
	var in store.SongNoteInput
	if !readJSON(w, r, &in) {
		return
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	n, err := a.Store.UpdateSongNote(r.Context(), id, uid(r), in.Body)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "note not found")
		return
	}
	if err != nil {
		a.serverError(w, "update song note", err)
		return
	}
	a.giftChanged(r.Context(), "notes", "stars")
	writeJSON(w, http.StatusOK, n)
}

func (a *api) deleteSongNote(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "note")
	if !ok {
		return
	}
	if err := a.Store.DeleteSongNote(r.Context(), id, uid(r)); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "note not found")
		return
	} else if err != nil {
		a.serverError(w, "delete song note", err)
		return
	}
	a.giftChanged(r.Context(), "notes", "stars")
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) scrapbook(w http.ResponseWriter, r *http.Request) {
	clips, err := a.Store.Clippings(r.Context())
	if err != nil {
		a.serverError(w, "scrapbook", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"clippings": clips})
}

func (a *api) addClipping(w http.ResponseWriter, r *http.Request) {
	var in struct {
		TrackID uuid.UUID        `json:"track_id"`
		Lines   []store.CardLine `json:"lines"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if err := store.ValidateLines(in.Lines); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	c, err := a.Store.AddClipping(r.Context(), uid(r), in.TrackID, in.Lines)
	if err != nil {
		a.serverError(w, "add clipping", err)
		return
	}
	a.giftChanged(r.Context(), "scrapbook")
	writeJSON(w, http.StatusCreated, c)
}

func (a *api) deleteClipping(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "clipping")
	if !ok {
		return
	}
	if err := a.Store.DeleteClipping(r.Context(), id, uid(r)); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "clipping not found")
		return
	} else if err != nil {
		a.serverError(w, "delete clipping", err)
		return
	}
	a.giftChanged(r.Context(), "scrapbook")
	w.WriteHeader(http.StatusNoContent)
}

const maxClipBytes = 25 << 20

var clipExts = map[string]bool{".webm": true, ".ogg": true, ".opus": true, ".m4a": true, ".mp4": true, ".mp3": true, ".wav": true, ".aac": true}

func (a *api) uploadClip(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxClipBytes+1<<20)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "clip must be a form with a file of 25 MB at most")
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "file is required")
		return
	}
	defer file.Close()
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if !clipExts[ext] {
		writeError(w, http.StatusBadRequest, "clip must be WebM, OGG, M4A, MP3 or WAV")
		return
	}
	path, err := a.saveUpload(file, ext)
	if err != nil {
		a.serverError(w, "save clip", err)
		return
	}
	ctx, ok := a.uploadConversation(w, r)
	if !ok {
		return
	}
	clip, err := a.Store.CreateVoiceClip(ctx, uid(r), path)
	if err != nil {
		a.serverError(w, "create clip", err)
		return
	}
	writeJSON(w, http.StatusCreated, clip)
}

func (a *api) voiceClip(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "clip")
	if !ok {
		return
	}
	c, err := a.Store.VoiceClip(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "clip not found")
		return
	}
	if err != nil {
		a.serverError(w, "clip", err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (a *api) trackDedications(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "track")
	if !ok {
		return
	}
	list, err := a.Store.Dedications(r.Context(), &id)
	if err != nil {
		a.serverError(w, "dedications", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"dedications": list})
}

func (a *api) allDedications(w http.ResponseWriter, r *http.Request) {
	list, err := a.Store.Dedications(r.Context(), nil)
	if err != nil {
		a.serverError(w, "dedications", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"dedications": list})
}

func (a *api) dedicatedIDs(w http.ResponseWriter, r *http.Request) {
	ids, err := a.Store.DedicatedTrackIDs(r.Context())
	if err != nil {
		a.serverError(w, "dedications", err)
		return
	}
	if ids == nil {
		ids = []uuid.UUID{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ids": ids})
}

func (a *api) createDedication(w http.ResponseWriter, r *http.Request) {
	trackID, ok := urlID(w, r, "track")
	if !ok {
		return
	}
	var in struct {
		ClipID uuid.UUID `json:"clip_id"`
		Note   string    `json:"note"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if utf8.RuneCountInString(in.Note) > 1000 {
		writeError(w, http.StatusBadRequest, "note of 1000 characters at most")
		return
	}
	d, err := a.Store.CreateDedication(r.Context(), uid(r), trackID, in.ClipID, strings.TrimSpace(in.Note))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "clip not found")
		return
	}
	if err != nil {
		a.serverError(w, "create dedication", err)
		return
	}
	me := currentUser(r)
	for _, u := range a.others(r.Context(), me.ID) {
		a.notify(u.ID, "dedications", me.DisplayName, "Dedication", "/dedications/")
	}
	a.giftChanged(r.Context(), "dedications", "stars")
	writeJSON(w, http.StatusCreated, d)
}

func (a *api) deleteDedication(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "dedication")
	if !ok {
		return
	}
	if err := a.Store.DeleteDedication(r.Context(), id, uid(r)); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "dedication not found")
		return
	} else if err != nil {
		a.serverError(w, "delete dedication", err)
		return
	}
	a.giftChanged(r.Context(), "dedications", "stars")
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) mixtapes(w http.ResponseWriter, r *http.Request) {
	list, err := a.Store.Mixtapes(r.Context(), uid(r))
	if err != nil {
		a.serverError(w, "mixtapes", err)
		return
	}
	if list == nil {
		list = []store.MixtapeSummary{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"mixtapes": list})
}

func (a *api) mixtape(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "mixtape")
	if !ok {
		return
	}
	m, err := a.Store.Mixtape(r.Context(), id, uid(r))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "mixtape not found")
		return
	}
	if err != nil {
		a.serverError(w, "mixtape", err)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (a *api) recipient(ctx context.Context, me uuid.UUID) (uuid.UUID, bool) {
	others := a.others(ctx, me)
	if len(others) == 0 {
		return uuid.Nil, false
	}
	return others[0].ID, true
}

func (a *api) createMixtape(w http.ResponseWriter, r *http.Request) {
	var in store.MixtapeInput
	if !readJSON(w, r, &in) {
		return
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	to, ok := a.recipient(r.Context(), uid(r))
	if !ok {
		writeError(w, http.StatusConflict, "no one to send it to yet")
		return
	}
	id, err := a.Store.SaveMixtape(r.Context(), nil, uid(r), to, in)
	if err != nil {
		a.serverError(w, "create mixtape", err)
		return
	}
	m, err := a.Store.Mixtape(r.Context(), id, uid(r))
	if err != nil {
		a.serverError(w, "mixtape", err)
		return
	}
	writeJSON(w, http.StatusCreated, m)
}

func (a *api) updateMixtape(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "mixtape")
	if !ok {
		return
	}
	var in store.MixtapeInput
	if !readJSON(w, r, &in) {
		return
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	to, ok := a.recipient(r.Context(), uid(r))
	if !ok {
		writeError(w, http.StatusConflict, "no one to send it to yet")
		return
	}
	if _, err := a.Store.SaveMixtape(r.Context(), &id, uid(r), to, in); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "draft not found")
		return
	} else if err != nil {
		a.serverError(w, "save mixtape", err)
		return
	}
	a.mixtape(w, r)
}

func (a *api) deleteMixtape(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "mixtape")
	if !ok {
		return
	}
	if err := a.Store.DeleteMixtape(r.Context(), id, uid(r)); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "draft not found")
		return
	} else if err != nil {
		a.serverError(w, "delete mixtape", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) sendMixtape(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "mixtape")
	if !ok {
		return
	}
	m, err := a.Store.SendMixtape(r.Context(), id, uid(r))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusConflict, "only a draft with tracks can be sent")
		return
	}
	if err != nil {
		a.serverError(w, "send mixtape", err)
		return
	}
	me := currentUser(r)
	a.notify(m.ToUser, "mixtapes", me.DisplayName, "Mixtape: "+m.Title, "/mixtapes/?id="+m.ID.String())
	a.giftChanged(r.Context(), "mixtapes")
	writeJSON(w, http.StatusOK, m)
}

func (a *api) openMixtape(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "mixtape")
	if !ok {
		return
	}
	if err := a.Store.OpenMixtape(r.Context(), id, uid(r)); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "mixtape not found")
		return
	} else if err != nil {
		a.serverError(w, "open mixtape", err)
		return
	}
	a.giftChanged(r.Context(), "mixtapes", "stars")
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) recentSearches(w http.ResponseWriter, r *http.Request) {
	list, err := a.Store.RecentSearches(r.Context(), uid(r))
	if err != nil {
		a.serverError(w, "recent searches", err)
		return
	}
	if list == nil {
		list = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"searches": list})
}

func (a *api) addRecentSearch(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Query string `json:"query"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if err := a.Store.AddRecentSearch(r.Context(), uid(r), in.Query); err != nil {
		a.serverError(w, "save search", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) deleteRecentSearch(w http.ResponseWriter, r *http.Request) {
	if err := a.Store.DeleteRecentSearch(r.Context(), uid(r), r.URL.Query().Get("q")); err != nil {
		a.serverError(w, "delete search", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type OurSong struct {
	TrackID *uuid.UUID `json:"track_id"`
	Story   string     `json:"story"`
}

func (a *api) ourSong(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var cfg OurSong
	a.setting(ctx, "our_song", &cfg)
	out := map[string]any{"track": nil, "story": cfg.Story, "plays": []store.PlayCount{}}
	if cfg.TrackID != nil {
		tracks, err := a.Store.TracksByID(ctx, []uuid.UUID{*cfg.TrackID})
		if err != nil {
			a.serverError(w, "our song", err)
			return
		}
		if len(tracks) > 0 {
			out["track"] = tracks[0]
		}
		plays, err := a.Store.PlayCounts(ctx, *cfg.TrackID)
		if err != nil {
			a.serverError(w, "play counts", err)
			return
		}
		out["plays"] = plays
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *api) setOurSong(w http.ResponseWriter, r *http.Request) {
	var in OurSong
	if !readJSON(w, r, &in) {
		return
	}
	if utf8.RuneCountInString(in.Story) > 20000 {
		writeError(w, http.StatusBadRequest, "story of 20000 characters at most")
		return
	}
	raw, _ := json.Marshal(in)
	if err := a.Store.SetAppSetting(r.Context(), "our_song", raw); err != nil {
		a.serverError(w, "save our song", err)
		return
	}
	a.ourSong(w, r)
}
