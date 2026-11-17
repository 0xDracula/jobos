package httpapi

import (
	"context"
	"encoding/json"
	"sort"
	"time"

	"github.com/google/uuid"

	"jobbos/api/internal/store"
)

type CalendarEvent struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Title       string `json:"title"`
	Date        string `json:"date"`
	Time        string `json:"time,omitempty"`
	Surprise    bool   `json:"surprise,omitempty"`
	Link        string `json:"link,omitempty"`
	AuthorID    string `json:"author_id,omitempty"`
	Placeholder bool   `json:"placeholder,omitempty"`
}

type calendarSource func(ctx context.Context, a *api, viewer *store.User, from, to time.Time) ([]CalendarEvent, error)

var calendarSources = map[string]calendarSource{}

func registerCalendarSource(name string, fn calendarSource) { calendarSources[name] = fn }

type RecapFigure struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Value  int    `json:"value"`
	Detail any    `json:"detail,omitempty"`
}

type RecapHighlight struct {
	Title       string     `json:"title"`
	Caption     string     `json:"caption,omitempty"`
	Date        string     `json:"date,omitempty"`
	PhotoURL    string     `json:"photo_url,omitempty"`
	TrackID     *uuid.UUID `json:"track_id,omitempty"`
	Link        string     `json:"link,omitempty"`
	Placeholder bool       `json:"placeholder,omitempty"`
}

type recapSource func(ctx context.Context, a *api, viewer *store.User, from, to time.Time) ([]RecapFigure, error)

var recapSources = map[string]recapSource{}

func registerRecapSource(name string, fn recapSource) { recapSources[name] = fn }

func sortedNames[T any](m map[string]T) []string {
	names := make([]string, 0, len(m))
	for n := range m {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}

func authoredBy(authorID string, viewer *store.User) bool {
	if authorID == "" {
		return viewer.Role == "admin"
	}
	return authorID == viewer.ID.String()
}

func (a *api) calendarEvents(ctx context.Context, viewer *store.User, first, last string) []CalendarEvent {
	from, to := dayBounds(first, last, a.homeTZ())
	out := []CalendarEvent{}
	for _, name := range sortedNames(calendarSources) {
		events, err := calendarSources[name](ctx, a, viewer, from, to)
		if err != nil {
			if a.Log != nil {
				a.Log.Warn("calendar source", "source", name, "err", err)
			}
			continue
		}
		for _, ev := range events {
			if ev.Date < first || ev.Date > last || (ev.Placeholder && viewer.Role != "admin") {
				continue
			}
			if ev.Surprise && !authoredBy(ev.AuthorID, viewer) {
				ev.Title, ev.Link = "", ""
			}
			out = append(out, ev)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		x, y := out[i], out[j]
		if x.Date != y.Date {
			return x.Date < y.Date
		}
		if x.Time != y.Time {
			return x.Time < y.Time
		}
		return x.Title < y.Title
	})
	return out
}

func dayBounds(first, last string, loc *time.Location) (time.Time, time.Time) {
	f, _ := time.ParseInLocation("2006-01-02", first, loc)
	l, _ := time.ParseInLocation("2006-01-02", last, loc)
	return f, l.AddDate(0, 0, 1).Add(-time.Nanosecond)
}

type SourcedFigure struct {
	Source string `json:"source"`
	RecapFigure
}

func (a *api) recapFigures(ctx context.Context, viewer *store.User, first, last string) []SourcedFigure {
	from, to := dayBounds(first, last, a.homeTZ())
	out := []SourcedFigure{}
	for _, name := range sortedNames(recapSources) {
		figures, err := recapSources[name](ctx, a, viewer, from, to)
		if err != nil {
			if a.Log != nil {
				a.Log.Warn("recap source", "source", name, "err", err)
			}
			continue
		}
		for _, f := range figures {
			if viewer.Role != "admin" {
				f.Detail = withoutPlaceholders(f.Detail)
			}
			out = append(out, SourcedFigure{Source: name, RecapFigure: f})
		}
	}
	return out
}

func withoutPlaceholders(detail any) any {
	if detail == nil {
		return nil
	}
	raw, err := json.Marshal(detail)
	if err != nil {
		return detail
	}
	placeholder := func(m map[string]any) bool { p, _ := m["placeholder"].(bool); return p }
	var list []map[string]any
	if json.Unmarshal(raw, &list) == nil {
		kept := []map[string]any{}
		for _, item := range list {
			if !placeholder(item) {
				kept = append(kept, item)
			}
		}
		if len(kept) == 0 {
			return nil
		}
		return kept
	}
	var one map[string]any
	if json.Unmarshal(raw, &one) == nil && placeholder(one) {
		return nil
	}
	return detail
}
