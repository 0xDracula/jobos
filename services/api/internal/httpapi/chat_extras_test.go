package httpapi

import (
	"testing"
	"time"
)

func TestSwapRevealWeek(t *testing.T) {
	cairo, err := time.LoadLocation("Africa/Cairo")
	if err != nil {
		t.Skip("no tzdata")
	}
	at := func(s string) time.Time {
		v, _ := time.ParseInLocation("2006-01-02 15:04", s, cairo)
		return v
	}
	for _, c := range []struct {
		now, notified, week string
		due                 bool
	}{
		{"2026-11-20 19:59", "", "", false},
		{"2026-11-20 20:05", "", "2026-11-20", true},
		{"2026-11-20 20:10", "2026-11-20", "2026-11-20", false},
		{"2026-11-21 07:00", "", "2026-11-20", true},
		{"2026-11-21 09:00", "", "", false},
	} {
		week, due := swapRevealWeek(at(c.now), cairo, c.notified)
		if due != c.due || (due && week != c.week) {
			t.Errorf("swapRevealWeek(%s, %q) = %q, %v; want %q, %v", c.now, c.notified, week, due, c.week, c.due)
		}
	}
}
