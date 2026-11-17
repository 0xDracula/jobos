package httpapi

import (
	"context"
	"math"
	"net/http"
	"sort"
	"time"

	"github.com/google/uuid"

	"jobbos/api/internal/store"
)

var statsRanges = map[string]int{"week": 7, "month": 30, "year": 365, "all": 0}

type Streaks struct {
	Current int `json:"current"`
	Longest int `json:"longest"`
}

func longestStreak(days []string) int {
	best, run := 0, 0
	var prev time.Time
	for i, s := range days {
		d, ok := parseDay(s)
		if !ok {
			continue
		}
		if i > 0 && d.Sub(prev) == 24*time.Hour {
			run++
		} else {
			run = 1
		}
		best = max(best, run)
		prev = d
	}
	return best
}

func currentStreak(days []string, today time.Time) int {
	set := make(map[string]bool, len(days))
	for _, d := range days {
		set[d] = true
	}
	day := today
	if !set[dayString(day)] {
		day = day.AddDate(0, 0, -1)
	}
	n := 0
	for set[dayString(day)] {
		n++
		day = day.AddDate(0, 0, -1)
	}
	return n
}

func topHour(hours [24]int) int {
	best := -1
	for h, n := range hours {
		if n > 0 && (best < 0 || n > hours[best]) {
			best = h
		}
	}
	return best
}

func cosine(x, y map[string]float64) float64 {
	var dot, nx, ny float64
	for k, v := range x {
		v = math.Log1p(v)
		nx += v * v
		if w, ok := y[k]; ok {
			dot += v * math.Log1p(w)
		}
	}
	for _, w := range y {
		w = math.Log1p(w)
		ny += w * w
	}
	if nx == 0 || ny == 0 {
		return 0
	}
	return dot / math.Sqrt(nx*ny)
}

func tasteMatch(a, b store.TasteProfile) *int {
	if len(a.Artists) == 0 || len(b.Artists) == 0 {
		return nil
	}
	score := cosine(a.Artists, b.Artists)
	if len(a.Tags) > 0 && len(b.Tags) > 0 {
		score = (score + cosine(a.Tags, b.Tags)) / 2
	}
	pct := int(math.Round(100 * score))
	return &pct
}

type ListeningStats struct {
	UserID     uuid.UUID             `json:"user_id"`
	Range      string                `json:"range,omitempty"`
	From       *string               `json:"from"`
	Totals     store.ListeningTotals `json:"totals"`
	TopSongs   []store.PlayedTrack   `json:"top_songs"`
	TopArtists []store.ArtistPlays   `json:"top_artists"`
	TopGenres  []store.TagWeight     `json:"top_genres"`
	Hours      [24]int               `json:"hours"`
	TopHour    int                   `json:"top_hour"`
	Streaks    Streaks               `json:"streaks"`
}

func (a *api) window(first, end time.Time) store.Window {
	loc := a.homeTZ()
	var w store.Window
	if !first.IsZero() {
		f := time.Date(first.Year(), first.Month(), first.Day(), 0, 0, 0, 0, loc)
		w.From = &f
	}
	if !end.IsZero() {
		e := time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, loc)
		w.To = &e
	}
	return w
}

func (a *api) listeningStats(ctx context.Context, userID uuid.UUID, first, end, today time.Time, limit int) (ListeningStats, error) {
	tz := a.homeTZ().String()
	w := a.window(first, end)
	st := ListeningStats{UserID: userID}
	if !first.IsZero() {
		f := dayString(first)
		st.From = &f
	}
	var err error
	if st.Totals, err = a.Store.ListeningTotals(ctx, userID, w, tz); err != nil {
		return st, err
	}
	if st.TopSongs, err = a.Store.TopTracks(ctx, userID, w, limit); err != nil {
		return st, err
	}
	if st.TopArtists, err = a.Store.TopArtists(ctx, userID, w, limit); err != nil {
		return st, err
	}
	if st.TopGenres, err = a.Store.TopTags(ctx, userID, w, 8); err != nil {
		return st, err
	}
	if st.Hours, err = a.Store.HourMinutes(ctx, userID, w, tz); err != nil {
		return st, err
	}
	st.TopHour = topHour(st.Hours)
	days, err := a.Store.ListeningDays(ctx, userID, w.To, tz)
	if err != nil {
		return st, err
	}
	st.Streaks.Current = currentStreak(days, today)
	inWindow := days
	if st.From != nil {
		i := sort.SearchStrings(days, *st.From)
		inWindow = days[i:]
	}
	st.Streaks.Longest = longestStreak(inWindow)
	return st, nil
}

func (a *api) subjectFor(w http.ResponseWriter, r *http.Request) (*store.User, bool) {
	me := currentUser(r)
	s := r.URL.Query().Get("user")
	if s == "" {
		return me, true
	}
	id, err := uuid.Parse(s)
	subject := a.member(r.Context(), id)
	if err != nil || subject == nil {
		writeError(w, http.StatusNotFound, "user not found")
		return nil, false
	}
	if !canSee(a.visibility(r.Context()), me, subject, "listening_history") {
		writeError(w, http.StatusForbidden, "listening history not visible")
		return nil, false
	}
	return subject, true
}

func (a *api) stats(w http.ResponseWriter, r *http.Request) {
	subject, ok := a.subjectFor(w, r)
	if !ok {
		return
	}
	rng := r.URL.Query().Get("range")
	if rng == "" {
		rng = "month"
	}
	days, ok := statsRanges[rng]
	if !ok {
		writeError(w, http.StatusBadRequest, "range must be week, month, year or all")
		return
	}
	today := civilDay(time.Now(), a.homeTZ())
	var first time.Time
	if days > 0 {
		first = today.AddDate(0, 0, 1-days)
	}
	st, err := a.listeningStats(r.Context(), subject.ID, first, time.Time{}, today, 10)
	if err != nil {
		a.serverError(w, "stats", err)
		return
	}
	st.Range = rng
	writeJSON(w, http.StatusOK, st)
}

type Exchanged struct {
	Total  int            `json:"total"`
	ByKind map[string]int `json:"by_kind"`
	Recent []store.Star   `json:"recent"`
}

var exchangeKinds = map[string]bool{"card": true, "mixtape": true, "dedication": true, "swap": true}

func exchangedSongs(stars []store.Star, from, to *time.Time, recent int) Exchanged {
	out := Exchanged{ByKind: map[string]int{}, Recent: []store.Star{}}
	for i := len(stars) - 1; i >= 0; i-- {
		s := stars[i]
		if !exchangeKinds[s.Kind] || from != nil && s.At.Before(*from) || to != nil && !s.At.Before(*to) {
			continue
		}
		out.Total++
		out.ByKind[s.Kind]++
		if len(out.Recent) < recent {
			out.Recent = append(out.Recent, s)
		}
	}
	return out
}

type OurSongPlays struct {
	Track *store.TrackView  `json:"track"`
	Plays []store.PlayCount `json:"plays"`
}

type TogetherStats struct {
	Members         []uuid.UUID       `json:"members"`
	MinutesTogether int               `json:"minutes_together"`
	BothLiked       int               `json:"both_liked"`
	BothLikedTracks []store.TrackView `json:"both_liked_tracks"`
	TasteMatch      *int              `json:"taste_match"`
	OurSong         OurSongPlays      `json:"our_song"`
	Exchanged       Exchanged         `json:"exchanged"`
}

func (a *api) pair(ctx context.Context) (store.User, store.User, bool) {
	list := a.memberList(ctx)
	if len(list) < 2 {
		return store.User{}, store.User{}, false
	}
	return list[0], list[1], true
}

func (a *api) ourSongPlays(ctx context.Context, w store.Window) (OurSongPlays, error) {
	out := OurSongPlays{Plays: []store.PlayCount{}}
	var cfg OurSong
	a.setting(ctx, "our_song", &cfg)
	if cfg.TrackID == nil {
		return out, nil
	}
	tracks, err := a.Store.TracksByID(ctx, []uuid.UUID{*cfg.TrackID})
	if err != nil {
		return out, err
	}
	if len(tracks) > 0 {
		out.Track = &tracks[0]
	}
	out.Plays, err = a.Store.PlayCountsIn(ctx, *cfg.TrackID, w)
	return out, err
}

func (a *api) togetherStats(ctx context.Context, w store.Window, liked int) (TogetherStats, error) {
	out := TogetherStats{Members: []uuid.UUID{}, BothLikedTracks: []store.TrackView{}}
	var err error
	if out.OurSong, err = a.ourSongPlays(ctx, w); err != nil {
		return out, err
	}
	stars, err := a.Store.Stars(ctx, dateOf(swapWeek(time.Now(), a.homeTZ())))
	if err != nil {
		return out, err
	}
	out.Exchanged = exchangedSongs(stars, w.From, w.To, 12)
	x, y, ok := a.pair(ctx)
	if !ok {
		return out, nil
	}
	out.Members = []uuid.UUID{x.ID, y.ID}
	if out.MinutesTogether, err = a.Store.TogetherMinutes(ctx, x.ID, y.ID, w); err != nil {
		return out, err
	}
	if out.BothLikedTracks, out.BothLiked, err = a.Store.BothLiked(ctx, x.ID, y.ID, w, liked); err != nil {
		return out, err
	}
	px, err := a.Store.TasteProfile(ctx, x.ID)
	if err != nil {
		return out, err
	}
	py, err := a.Store.TasteProfile(ctx, y.ID)
	if err != nil {
		return out, err
	}
	out.TasteMatch = tasteMatch(px, py)
	return out, nil
}

func (a *api) statsTogether(w http.ResponseWriter, r *http.Request) {
	st, err := a.togetherStats(r.Context(), store.Window{}, 12)
	if err != nil {
		a.serverError(w, "stats together", err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}
