package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jobbos/api/internal/store"
)

func init() {
	registerRecapSource("milestones", milestoneFigures)
}

type recapPeriod struct {
	Kind  string
	Start time.Time
	End   time.Time
}

func (p recapPeriod) last() time.Time { return p.End.AddDate(0, 0, -1) }

func monthOf(day time.Time) recapPeriod {
	s := time.Date(day.Year(), day.Month(), 1, 0, 0, 0, 0, time.UTC)
	return recapPeriod{Kind: "month", Start: s, End: s.AddDate(0, 1, 0)}
}

func yearOf(anchor, day time.Time) recapPeriod {
	s := occurrenceIn(anchor, day.Year())
	if s.After(day) {
		s = occurrenceIn(anchor, day.Year()-1)
	}
	return recapPeriod{Kind: "year", Start: s, End: occurrenceIn(anchor, s.Year()+1)}
}

func periodAt(kind, start string, anchor time.Time) (recapPeriod, bool) {
	day, ok := parseDay(start)
	if !ok {
		return recapPeriod{}, false
	}
	var p recapPeriod
	switch kind {
	case "month":
		p = monthOf(day)
	case "year":
		p = yearOf(anchor, day)
	default:
		return p, false
	}
	return p, p.Start.Equal(day)
}

func yearRelease(anchor, today time.Time) recapPeriod {
	if today.Before(anchor) {
		return yearOf(anchor, anchor)
	}
	return yearOf(anchor, today)
}

type RecapEntry struct {
	Period     string `json:"period"`
	StartsOn   string `json:"starts_on"`
	EndsOn     string `json:"ends_on"`
	ReleasedOn string `json:"released_on"`
	Opened     bool   `json:"opened"`
}

func entryOf(p recapPeriod, opened map[string]bool) RecapEntry {
	return RecapEntry{Period: p.Kind, StartsOn: dayString(p.Start), EndsOn: dayString(p.last()), ReleasedOn: dayString(p.End),
		Opened: opened[p.Kind+":"+dayString(p.Start)]}
}

func releasedMonths(firstListen, today time.Time) []recapPeriod {
	var out []recapPeriod
	if firstListen.IsZero() {
		return out
	}
	stop := monthOf(firstListen).Start
	for p := monthOf(monthOf(today).Start.AddDate(0, 0, -1)); !p.Start.Before(stop) && len(out) < 36; p = monthOf(p.Start.AddDate(0, 0, -1)) {
		out = append(out, p)
	}
	return out
}

func releasedYears(anchor, today time.Time) []recapPeriod {
	var out []recapPeriod
	for p := yearOf(anchor, anchor); !p.End.After(today); p = yearOf(anchor, p.End) {
		out = append([]recapPeriod{p}, out...)
	}
	return out
}

func (a *api) recapAnchor(ctx context.Context) time.Time {
	return dateOf(a.milestoneStart(ctx))
}

func (a *api) recaps(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	me := currentUser(r)
	today := civilDay(time.Now(), a.homeTZ())
	opened, err := a.Store.OpenedRecaps(ctx, me.ID)
	if err != nil {
		a.serverError(w, "recaps", err)
		return
	}
	first, err := a.Store.FirstListen(ctx, me.ID)
	if err != nil {
		a.serverError(w, "recaps", err)
		return
	}
	var firstDay time.Time
	if first != nil {
		firstDay = civilDay(*first, a.homeTZ())
	}
	anchor := a.recapAnchor(ctx)
	months, years := []RecapEntry{}, []RecapEntry{}
	for _, p := range releasedMonths(firstDay, today) {
		months = append(months, entryOf(p, opened))
	}
	for _, p := range releasedYears(anchor, today) {
		years = append(years, entryOf(p, opened))
	}
	var latest *RecapEntry
	if len(years) > 0 && !years[0].Opened && years[0].ReleasedOn > dayString(today.AddDate(0, 0, -30)) {
		latest = &years[0]
	} else if len(months) > 0 && !months[0].Opened && months[0].ReleasedOn == dayString(monthOf(today).Start) {
		latest = &months[0]
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"months": months, "years": years, "latest": latest,
		"next_month": dayString(monthOf(today).End), "next_year": dayString(yearRelease(anchor, today).End),
	})
}

type Slide struct {
	Kind string `json:"kind"`
	Data any    `json:"data,omitempty"`
}

type Recap struct {
	Period   string    `json:"period"`
	StartsOn string    `json:"starts_on"`
	EndsOn   string    `json:"ends_on"`
	Subject  uuid.UUID `json:"subject"`
	Preview  bool      `json:"preview"`
	Hidden   []string  `json:"hidden"`
	Slides   []Slide   `json:"slides"`
}

type noteView struct {
	AuthorID    uuid.UUID `json:"author_id"`
	Body        string    `json:"body"`
	Placeholder bool      `json:"placeholder"`
}

func figureSlides(figures []SourcedFigure) []Slide {
	var out []Slide
	var numbers []SourcedFigure
	for _, f := range figures {
		if f.Detail != nil {
			out = append(out, Slide{Kind: "highlight", Data: f})
		}
		if f.Value > 0 {
			numbers = append(numbers, f)
		}
	}
	if len(numbers) > 0 {
		out = append(out, Slide{Kind: "figures", Data: map[string]any{"figures": numbers}})
	}
	return out
}

func listeningSlides(st ListeningStats) []Slide {
	if st.Totals.Minutes == 0 && st.Totals.Plays == 0 {
		return nil
	}
	out := []Slide{{Kind: "listening", Data: map[string]any{
		"totals": st.Totals, "longest_streak": st.Streaks.Longest, "top_hour": st.TopHour, "hours": st.Hours,
	}}}
	if len(st.TopSongs) > 0 {
		out = append(out, Slide{Kind: "top_songs", Data: map[string]any{"tracks": st.TopSongs}})
	}
	if len(st.TopArtists) > 0 {
		out = append(out, Slide{Kind: "top_artists", Data: map[string]any{"artists": st.TopArtists, "genres": st.TopGenres}})
	}
	return out
}

func visibleNotes(notes []store.RecapNote, viewer *store.User) []noteView {
	out := []noteView{}
	for _, n := range notes {
		if n.Body != "" && (!n.Placeholder || viewer.Role == "admin") {
			out = append(out, noteView{AuthorID: n.AuthorID, Body: n.Body, Placeholder: n.Placeholder})
		}
	}
	return out
}

func (a *api) buildRecap(ctx context.Context, viewer, subject *store.User, p, notesFrom recapPeriod, preview bool) (Recap, error) {
	today := civilDay(time.Now(), a.homeTZ())
	rc := Recap{Period: p.Kind, StartsOn: dayString(p.Start), EndsOn: dayString(p.last()), Subject: subject.ID, Preview: preview, Hidden: []string{}, Slides: []Slide{}}
	w := a.window(p.Start, p.End)
	cover := map[string]any{"name": subject.DisplayName}
	rc.Slides = append(rc.Slides, Slide{Kind: "cover", Data: cover})

	var listening []Slide
	if canSee(a.visibility(ctx), viewer, subject, "listening_history") {
		st, err := a.listeningStats(ctx, subject.ID, p.Start, p.End, today, 5)
		if err != nil {
			return rc, err
		}
		listening = listeningSlides(st)
	} else {
		rc.Hidden = append(rc.Hidden, "listening")
	}
	together, err := a.togetherStats(ctx, w, 12)
	if err != nil {
		return rc, err
	}
	figures := figureSlides(a.recapFigures(ctx, viewer, dayString(p.Start), dayString(p.last())))
	notes, err := a.Store.RecapNotes(ctx, notesFrom.Kind, notesFrom.Start, viewer.Role == "admin")
	if err != nil {
		return rc, err
	}

	if p.Kind == "month" {
		rc.Slides = append(rc.Slides, listening...)
		if len(together.Members) == 2 {
			rc.Slides = append(rc.Slides, Slide{Kind: "together", Data: together})
		}
		rc.Slides = append(rc.Slides, figures...)
		pick := func(n noteView) bool { return n.AuthorID != subject.ID }
		if preview && subject.ID == viewer.ID {
			pick = func(n noteView) bool { return n.AuthorID == viewer.ID }
		}
		for _, n := range visibleNotes(notes, viewer) {
			if pick(n) {
				rc.Slides = append(rc.Slides, Slide{Kind: "note", Data: n})
				break
			}
		}
		return rc, nil
	}

	rc.Slides = append(rc.Slides, Slide{Kind: "together_minutes", Data: map[string]any{"minutes": together.MinutesTogether, "taste_match": together.TasteMatch}})
	if len(together.Members) == 2 {
		shared, err := a.Store.SharedTopTracks(ctx, together.Members[0], together.Members[1], w, 5)
		if err != nil {
			return rc, err
		}
		if len(shared) > 0 {
			rc.Slides = append(rc.Slides, Slide{Kind: "shared_songs", Data: map[string]any{"tracks": shared}})
		}
	}
	if together.Exchanged.Total > 0 {
		rc.Slides = append(rc.Slides, Slide{Kind: "exchanged", Data: together.Exchanged})
	}
	rc.Slides = append(rc.Slides, figures...)
	rc.Slides = append(rc.Slides, listening...)
	if list := visibleNotes(notes, viewer); len(list) > 0 {
		rc.Slides = append(rc.Slides, Slide{Kind: "notes", Data: map[string]any{"notes": list}})
	}
	return rc, nil
}

func milestoneFigures(ctx context.Context, a *api, _ *store.User, from, to time.Time) ([]RecapFigure, error) {
	loc := a.homeTZ()
	now := time.Now().In(loc)
	first, last := dayString(civilDay(from, loc)), dayString(civilDay(to, loc))
	items := []RecapHighlight{}
	for _, m := range milestoneDates(a.milestoneStart(ctx), to.In(loc), now) {
		if m.Reached && m.Date >= first && m.Date <= last {
			items = append(items, RecapHighlight{Title: m.Label, Date: m.Date})
		}
	}
	if len(items) == 0 {
		return nil, nil
	}
	return []RecapFigure{{Key: "milestones", Label: "Milestones", Value: len(items), Detail: items}}, nil
}

func (a *api) recapSubject(w http.ResponseWriter, r *http.Request) (*store.User, bool) {
	s := r.URL.Query().Get("for")
	if s == "" {
		return currentUser(r), true
	}
	id, err := uuid.Parse(s)
	subject := a.member(r.Context(), id)
	if err != nil || subject == nil {
		writeError(w, http.StatusNotFound, "user not found")
		return nil, false
	}
	return subject, true
}

func (a *api) recap(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	p, ok := periodAt(chi.URLParam(r, "period"), r.URL.Query().Get("start"), a.recapAnchor(ctx))
	today := civilDay(time.Now(), a.homeTZ())
	if !ok || p.End.After(today) || p.Kind == "year" && p.Start.Before(a.recapAnchor(ctx)) {
		writeError(w, http.StatusNotFound, "recap not available")
		return
	}
	subject, ok := a.recapSubject(w, r)
	if !ok {
		return
	}
	rc, err := a.buildRecap(ctx, currentUser(r), subject, p, p, false)
	if err != nil {
		a.serverError(w, "recap", err)
		return
	}
	writeJSON(w, http.StatusOK, rc)
}

func (a *api) recapPreview(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	today := civilDay(time.Now(), a.homeTZ())
	anchor := a.recapAnchor(ctx)
	var p, notes recapPeriod
	switch chi.URLParam(r, "period") {
	case "month":
		p = monthOf(today)
		notes = p
	case "year":
		p = yearOf(anchor, today)
		notes = yearRelease(anchor, today)
	default:
		writeError(w, http.StatusNotFound, "period must be month or year")
		return
	}
	subject, ok := a.recapSubject(w, r)
	if !ok {
		return
	}
	rc, err := a.buildRecap(ctx, currentUser(r), subject, p, notes, true)
	if err != nil {
		a.serverError(w, "recap preview", err)
		return
	}
	writeJSON(w, http.StatusOK, rc)
}

func (a *api) recapOpened(w http.ResponseWriter, r *http.Request) {
	var in struct {
		StartsOn string `json:"starts_on"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	p, ok := periodAt(chi.URLParam(r, "period"), in.StartsOn, a.recapAnchor(r.Context()))
	if !ok {
		writeError(w, http.StatusBadRequest, "starts_on must be the first day of a period")
		return
	}
	a.noContent(w, "recap opened", a.Store.MarkRecapOpened(r.Context(), uid(r), p.Kind, p.Start))
}

type NoteSlot struct {
	Period     string `json:"period"`
	StartsOn   string `json:"starts_on"`
	EndsOn     string `json:"ends_on"`
	ReleasedOn string `json:"released_on"`
}

func (a *api) recapNotes(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	notes, err := a.Store.AuthorRecapNotes(ctx, uid(r), seesPlaceholders(r))
	if err != nil {
		a.serverError(w, "recap notes", err)
		return
	}
	today := civilDay(time.Now(), a.homeTZ())
	this := monthOf(today)
	year := yearRelease(a.recapAnchor(ctx), today)
	slots := []NoteSlot{}
	for _, p := range []recapPeriod{monthOf(this.Start.AddDate(0, 0, -1)), this, monthOf(this.End), year, yearOf(year.Start, year.End)} {
		slots = append(slots, NoteSlot{Period: p.Kind, StartsOn: dayString(p.Start), EndsOn: dayString(p.last()), ReleasedOn: dayString(p.End)})
	}
	writeJSON(w, http.StatusOK, map[string]any{"notes": notes, "slots": slots})
}

func (a *api) setRecapNote(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Period   string `json:"period"`
		StartsOn string `json:"starts_on"`
		Body     string `json:"body"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	ctx := r.Context()
	p, ok := periodAt(in.Period, in.StartsOn, a.recapAnchor(ctx))
	if !ok {
		writeError(w, http.StatusBadRequest, "starts_on must be the first day of a month or of a year from the milestone start")
		return
	}
	body, err := store.ValidRecapNote(in.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	n, err := a.Store.SetRecapNote(ctx, uid(r), p.Kind, p.Start, body)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		a.serverError(w, "save recap note", err)
		return
	}
	a.datesChanged(ctx)
	writeJSON(w, http.StatusOK, map[string]any{"note": n})
}
