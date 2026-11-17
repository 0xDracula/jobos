package httpapi

import (
	"context"
	"time"

	"jobbos/api/internal/store"
)

type CalendarEvent struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Title    string `json:"title"`
	Date     string `json:"date"`
	Time     string `json:"time,omitempty"`
	Surprise bool   `json:"surprise,omitempty"`
	Link     string `json:"link,omitempty"`
	AuthorID string `json:"author_id,omitempty"`
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

type recapSource func(ctx context.Context, a *api, viewer *store.User, from, to time.Time) ([]RecapFigure, error)

var recapSources = map[string]recapSource{}

func registerRecapSource(name string, fn recapSource) { recapSources[name] = fn }
