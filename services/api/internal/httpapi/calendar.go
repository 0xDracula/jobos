package httpapi

import (
	"context"
	"net/http"
	"time"

	"jobbos/api/internal/store"
)

func init() {
	registerCalendarSource("dates", dateEvents("birthday", "anniversary", "other"))
	registerCalendarSource("countdowns", dateEvents("countdown"))
	registerCalendarSource("plans", dateEvents("plan"))
	registerCalendarSource("milestones", milestoneEvents)
	registerCalendarSource("holidays", holidayEvents)
}

func parseDay(s string) (time.Time, bool) {
	t, err := time.Parse("2006-01-02", s)
	return t, err == nil
}

func dayString(t time.Time) string { return t.Format("2006-01-02") }

func civilDay(t time.Time, loc *time.Location) time.Time { return dateOf(t.In(loc)) }

func occurrenceIn(first time.Time, year int) time.Time {
	d := time.Date(year, first.Month(), first.Day(), 0, 0, 0, 0, time.UTC)
	if d.Month() != first.Month() {
		d = time.Date(year, first.Month()+1, 0, 0, 0, 0, 0, time.UTC)
	}
	return d
}

func occurrences(date time.Time, recurring bool, first, last time.Time) []time.Time {
	if !recurring {
		if date.Before(first) || date.After(last) {
			return nil
		}
		return []time.Time{date}
	}
	var out []time.Time
	for y := max(first.Year(), date.Year()); y <= last.Year(); y++ {
		if d := occurrenceIn(date, y); !d.Before(first) && !d.After(last) {
			out = append(out, d)
		}
	}
	return out
}

func nextOccurrence(date time.Time, recurring bool, day time.Time) (time.Time, bool) {
	if !recurring {
		return date, !date.Before(day)
	}
	for y := max(day.Year(), date.Year()); ; y++ {
		if d := occurrenceIn(date, y); !d.Before(day) {
			return d, true
		}
	}
}

func dateEventID(d store.ImportantDate, on time.Time) string {
	if d.Recurring {
		return "date:" + d.ID.String() + ":" + on.Format("2006")
	}
	return "date:" + d.ID.String()
}

func dateEvents(kinds ...string) calendarSource {
	return func(ctx context.Context, a *api, viewer *store.User, from, to time.Time) ([]CalendarEvent, error) {
		dates, err := a.Store.ImportantDates(ctx, kinds, viewer.Role == "admin")
		if err != nil {
			return nil, err
		}
		first, last := civilDay(from, a.homeTZ()), civilDay(to, a.homeTZ())
		var out []CalendarEvent
		for _, d := range dates {
			day, ok := parseDay(d.Date)
			if !ok {
				continue
			}
			for _, on := range occurrences(day, d.Recurring, first, last) {
				ev := CalendarEvent{
					ID: dateEventID(d, on), Kind: d.Kind, Title: d.Label, Date: dayString(on),
					Surprise: d.Surprise, Link: "/calendar/?date=" + dayString(on), Placeholder: d.Placeholder,
				}
				if d.Time != nil {
					ev.Time = *d.Time
				}
				if d.AuthorID != nil {
					ev.AuthorID = d.AuthorID.String()
				}
				out = append(out, ev)
			}
		}
		return out, nil
	}
}

func milestoneEvents(ctx context.Context, a *api, viewer *store.User, from, to time.Time) ([]CalendarEvent, error) {
	loc := a.homeTZ()
	start := a.milestoneStart(ctx)
	now := time.Now().In(loc)
	if viewer.Role != "admin" && now.Before(start) {
		return nil, nil
	}
	first, last := civilDay(from, loc), civilDay(to, loc)
	var out []CalendarEvent
	for _, m := range milestoneDates(start, to.In(loc), now) {
		day, ok := parseDay(m.Date)
		if !ok || day.Before(first) || day.After(last) {
			continue
		}
		out = append(out, CalendarEvent{
			ID: "milestone:" + m.ID, Kind: "milestone", Title: m.Label, Date: m.Date,
			Surprise: m.ID == "together" && now.Before(start),
		})
	}
	return out, nil
}

func holidayEvents(ctx context.Context, a *api, _ *store.User, from, to time.Time) ([]CalendarEvent, error) {
	first, last := civilDay(from, a.homeTZ()), civilDay(to, a.homeTZ())
	var out []CalendarEvent
	for _, h := range a.holidays(ctx) {
		for d := first; !d.After(last); d = d.AddDate(0, 0, 1) {
			md := d.Format("01-02")
			in := h.Start <= h.End && md >= h.Start && md <= h.End || h.Start > h.End && (md >= h.Start || md <= h.End)
			if in {
				out = append(out, CalendarEvent{ID: "holiday:" + h.ID + ":" + dayString(d), Kind: "holiday", Title: h.Name, Date: dayString(d)})
			}
		}
	}
	return out, nil
}

const maxCalendarDays = 400

func (a *api) calendar(w http.ResponseWriter, r *http.Request) {
	today := civilDay(time.Now(), a.homeTZ())
	first, last := today, today.AddDate(0, 0, 60)
	if s := r.URL.Query().Get("from"); s != "" {
		d, ok := parseDay(s)
		if !ok {
			writeError(w, http.StatusBadRequest, "from must be YYYY-MM-DD")
			return
		}
		first = d
	}
	if s := r.URL.Query().Get("to"); s != "" {
		d, ok := parseDay(s)
		if !ok {
			writeError(w, http.StatusBadRequest, "to must be YYYY-MM-DD")
			return
		}
		last = d
	}
	if last.Before(first) || last.Sub(first) > maxCalendarDays*24*time.Hour {
		writeError(w, http.StatusBadRequest, "a range of 0 to 400 days")
		return
	}
	events := a.calendarEvents(r.Context(), currentUser(r), dayString(first), dayString(last))
	writeJSON(w, http.StatusOK, map[string]any{"today": dayString(today), "from": dayString(first), "to": dayString(last), "events": events})
}
