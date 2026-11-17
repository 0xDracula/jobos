package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jobbos/api/internal/realtime"
	"jobbos/api/internal/store"
)

type DatesStore interface {
	ImportantDates(ctx context.Context, kinds []string, withPlaceholders bool) ([]store.ImportantDate, error)
	ImportantDate(ctx context.Context, id uuid.UUID) (store.ImportantDate, error)
	InsertImportantDate(ctx context.Context, authorID *uuid.UUID, in store.DateInput, placeholder bool) (store.ImportantDate, error)
	UpdateImportantDate(ctx context.Context, id uuid.UUID, in store.DateInput) (store.ImportantDate, error)
	DeleteImportantDate(ctx context.Context, id uuid.UUID) error
	DatePlaceholdersLeft(ctx context.Context) (int, error)
	MarkReminderSent(ctx context.Context, eventID string, occursOn time.Time, userID uuid.UUID) (bool, error)
	RecapNotes(ctx context.Context, period string, startsOn time.Time, withPlaceholders bool) ([]store.RecapNote, error)
	AuthorRecapNotes(ctx context.Context, authorID uuid.UUID, withPlaceholders bool) ([]store.RecapNote, error)
	SetRecapNote(ctx context.Context, authorID uuid.UUID, period string, startsOn time.Time, body string) (*store.RecapNote, error)
	SeedRecapNote(ctx context.Context, authorID uuid.UUID, period string, startsOn time.Time, body string, placeholder bool) error
	RecapNotePlaceholders(ctx context.Context) (int, error)
	MarkRecapOpened(ctx context.Context, userID uuid.UUID, period string, startsOn time.Time) error
	OpenedRecaps(ctx context.Context, userID uuid.UUID) (map[string]bool, error)
	ListeningTotals(ctx context.Context, userID uuid.UUID, w store.Window, tz string) (store.ListeningTotals, error)
	TopTracks(ctx context.Context, userID uuid.UUID, w store.Window, limit int) ([]store.PlayedTrack, error)
	TopArtists(ctx context.Context, userID uuid.UUID, w store.Window, limit int) ([]store.ArtistPlays, error)
	TopTags(ctx context.Context, userID uuid.UUID, w store.Window, limit int) ([]store.TagWeight, error)
	HourMinutes(ctx context.Context, userID uuid.UUID, w store.Window, tz string) ([24]int, error)
	ListeningDays(ctx context.Context, userID uuid.UUID, to *time.Time, tz string) ([]string, error)
	TogetherMinutes(ctx context.Context, a, b uuid.UUID, w store.Window) (int, error)
	BothLiked(ctx context.Context, a, b uuid.UUID, w store.Window, limit int) ([]store.TrackView, int, error)
	TasteProfile(ctx context.Context, userID uuid.UUID) (store.TasteProfile, error)
	SharedTopTracks(ctx context.Context, a, b uuid.UUID, w store.Window, limit int) ([]store.SharedTrack, error)
	PlayCountsIn(ctx context.Context, trackID uuid.UUID, w store.Window) ([]store.PlayCount, error)
	FirstListen(ctx context.Context, userID uuid.UUID) (*time.Time, error)
}

func (a *api) registerDatesRoutes(r chi.Router) {
	r.Get("/calendar", a.calendar)
	r.Get("/dates", a.listDates)
	r.Post("/dates", a.createDate)
	r.Put("/dates/{id}", a.updateDate)
	r.Delete("/dates/{id}", a.deleteDate)
	r.Get("/countdowns", a.countdowns)

	r.Get("/stats", a.stats)
	r.Get("/stats/together", a.statsTogether)

	r.Get("/recaps", a.recaps)
	r.Get("/recaps/notes", a.recapNotes)
	r.Put("/recaps/notes", a.setRecapNote)
	r.Get("/recaps/{period}", a.recap)
	r.Post("/recaps/{period}/opened", a.recapOpened)
}

func (a *api) registerDatesAdminRoutes(r chi.Router) {
	r.Get("/recaps/{period}/current", a.recapPreview)
}

func (a *api) datesChanged(ctx context.Context) {
	a.broadcast(ctx, realtime.NewEvent("dates.update", nil))
}

type DateView struct {
	store.ImportantDate
	Editable bool `json:"editable"`
}

func canEditDate(d store.ImportantDate, viewer *store.User) bool {
	if d.AuthorID != nil && *d.AuthorID == viewer.ID {
		return true
	}
	return viewer.Role == "admin" && (d.AuthorID == nil || !d.Surprise)
}

func viewDate(d store.ImportantDate, viewer *store.User) DateView {
	author := ""
	if d.AuthorID != nil {
		author = d.AuthorID.String()
	}
	if d.Surprise && !authoredBy(author, viewer) {
		d.Label, d.Note, d.PlaylistID, d.UserID, d.RemindMinutes, d.Decorations = "", "", nil, nil, nil, []string{}
	}
	return DateView{ImportantDate: d, Editable: canEditDate(d, viewer)}
}

func (a *api) listDates(w http.ResponseWriter, r *http.Request) {
	dates, err := a.Store.ImportantDates(r.Context(), nil, seesPlaceholders(r))
	if err != nil {
		a.serverError(w, "dates", err)
		return
	}
	me := currentUser(r)
	out := make([]DateView, 0, len(dates))
	for _, d := range dates {
		out = append(out, viewDate(d, me))
	}
	writeJSON(w, http.StatusOK, map[string]any{"dates": out})
}

func (a *api) createDate(w http.ResponseWriter, r *http.Request) {
	var in store.DateInput
	if !readJSON(w, r, &in) {
		return
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	me := uid(r)
	d, err := a.Store.InsertImportantDate(r.Context(), &me, in, false)
	if errors.Is(err, store.ErrUnknownRef) {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err != nil {
		a.serverError(w, "create date", err)
		return
	}
	a.datesChanged(r.Context())
	writeJSON(w, http.StatusCreated, viewDate(d, currentUser(r)))
}

func (a *api) editableDate(w http.ResponseWriter, r *http.Request) (store.ImportantDate, bool) {
	id, ok := urlID(w, r, "date")
	if !ok {
		return store.ImportantDate{}, false
	}
	d, err := a.Store.ImportantDate(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) || err == nil && d.Placeholder && !seesPlaceholders(r) {
		writeError(w, http.StatusNotFound, "date not found")
		return d, false
	}
	if err != nil {
		a.serverError(w, "date", err)
		return d, false
	}
	if !canEditDate(d, currentUser(r)) {
		writeError(w, http.StatusForbidden, "only its author can change this date")
		return d, false
	}
	return d, true
}

func (a *api) updateDate(w http.ResponseWriter, r *http.Request) {
	d, ok := a.editableDate(w, r)
	if !ok {
		return
	}
	var in store.DateInput
	if !readJSON(w, r, &in) {
		return
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	saved, err := a.Store.UpdateImportantDate(r.Context(), d.ID, in)
	switch {
	case errors.Is(err, store.ErrUnknownRef):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "date not found")
	case err != nil:
		a.serverError(w, "update date", err)
	default:
		a.datesChanged(r.Context())
		writeJSON(w, http.StatusOK, viewDate(saved, currentUser(r)))
	}
}

func (a *api) deleteDate(w http.ResponseWriter, r *http.Request) {
	d, ok := a.editableDate(w, r)
	if !ok {
		return
	}
	if err := a.Store.DeleteImportantDate(r.Context(), d.ID); err != nil && !errors.Is(err, store.ErrNotFound) {
		a.serverError(w, "delete date", err)
		return
	}
	a.datesChanged(r.Context())
	w.WriteHeader(http.StatusNoContent)
}

type Countdown struct {
	ID          uuid.UUID  `json:"id"`
	Title       string     `json:"title"`
	Date        string     `json:"date"`
	Time        *string    `json:"time"`
	Days        int        `json:"days"`
	Surprise    bool       `json:"surprise"`
	AuthorID    *uuid.UUID `json:"author_id"`
	Placeholder bool       `json:"placeholder"`
	Editable    bool       `json:"editable"`
}

func upcomingCountdowns(dates []store.ImportantDate, today time.Time, viewer *store.User) []Countdown {
	out := []Countdown{}
	for _, d := range dates {
		day, ok := parseDay(d.Date)
		if !ok {
			continue
		}
		next, ok := nextOccurrence(day, d.Recurring, today)
		if !ok {
			continue
		}
		v := viewDate(d, viewer)
		out = append(out, Countdown{
			ID: d.ID, Title: v.Label, Date: dayString(next), Time: d.Time, Days: int(next.Sub(today).Hours() / 24),
			Surprise: d.Surprise, AuthorID: d.AuthorID, Placeholder: d.Placeholder, Editable: v.Editable,
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		x, y := out[i], out[j]
		if x.Date != y.Date {
			return x.Date < y.Date
		}
		return x.Time == nil && y.Time != nil || x.Time != nil && y.Time != nil && *x.Time < *y.Time
	})
	return out
}

func (a *api) countdowns(w http.ResponseWriter, r *http.Request) {
	dates, err := a.Store.ImportantDates(r.Context(), []string{"countdown"}, seesPlaceholders(r))
	if err != nil {
		a.serverError(w, "countdowns", err)
		return
	}
	today := civilDay(time.Now(), a.homeTZ())
	writeJSON(w, http.StatusOK, map[string]any{"today": dayString(today), "countdowns": upcomingCountdowns(dates, today, currentUser(r))})
}

func (a *api) occasionHolidays(ctx context.Context) []Holiday {
	dates, err := a.Store.ImportantDates(ctx, nil, false)
	if err != nil {
		a.Log.Warn("room occasions", "err", err)
		return nil
	}
	today := civilDay(time.Now(), a.homeTZ())
	var out []Holiday
	for _, d := range dates {
		day, ok := parseDay(d.Date)
		if !ok || d.Surprise || (len(d.Decorations) == 0 && d.PlaylistID == nil) {
			continue
		}
		on := day
		if d.Recurring {
			on = occurrenceIn(day, today.Year())
		} else if on.Before(today.AddDate(0, 0, -1)) || on.After(today.AddDate(0, 0, 1)) {
			continue
		}
		md := on.Format("01-02")
		out = append(out, Holiday{ID: "date:" + d.ID.String(), Name: d.Label, Start: md, End: md, Decorations: d.Decorations, PlaylistID: d.PlaylistID})
	}
	return out
}

func init() {
	registerPlaceholders(placeholderSet{
		Name:  "dates",
		Label: "Calendar",
		Seed:  seedDates,
		Count: func(ctx context.Context, a *api) (int, error) { return a.Store.DatePlaceholdersLeft(ctx) },
		Admin: "/admin/#gift",
	})
	registerPlaceholders(placeholderSet{
		Name:  "recaps",
		Label: "Recap notes",
		Seed:  seedRecapNotes,
		Count: func(ctx context.Context, a *api) (int, error) { return a.Store.RecapNotePlaceholders(ctx) },
		Admin: "/admin/#gift",
	})
}

func (a *api) seedAuthors(ctx context.Context) (admin, member *uuid.UUID) {
	for _, u := range a.memberList(ctx) {
		id := u.ID
		if u.Role == "admin" && admin == nil {
			admin = &id
		}
		if u.Role == "member" && member == nil {
			member = &id
		}
	}
	return admin, member
}

func seedDates(ctx context.Context, a *api, raw json.RawMessage) error {
	var file struct {
		Dates []struct {
			store.DateInput
			User        string `json:"user"`
			Placeholder bool   `json:"placeholder"`
		} `json:"dates"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		return err
	}
	admin, member := a.seedAuthors(ctx)
	for _, d := range file.Dates {
		in := d.DateInput
		switch d.User {
		case "admin":
			in.UserID = admin
		case "member":
			in.UserID = member
		}
		if err := in.Validate(); err != nil {
			return err
		}
		if _, err := a.Store.InsertImportantDate(ctx, admin, in, d.Placeholder); err != nil {
			return err
		}
	}
	return nil
}

func seedRecapNotes(ctx context.Context, a *api, raw json.RawMessage) error {
	var file struct {
		Notes []struct {
			Period      string `json:"period"`
			StartsOn    string `json:"starts_on"`
			Body        string `json:"body"`
			Placeholder bool   `json:"placeholder"`
		} `json:"notes"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		return err
	}
	admin, _ := a.seedAuthors(ctx)
	if admin == nil {
		return errors.New("no admin to write the notes")
	}
	for _, n := range file.Notes {
		day, ok := parseDay(n.StartsOn)
		if !ok || (n.Period != "month" && n.Period != "year") {
			return errors.New("note needs a period and a starts_on date")
		}
		if err := a.Store.SeedRecapNote(ctx, *admin, n.Period, day, n.Body, n.Placeholder); err != nil {
			return err
		}
	}
	return nil
}
