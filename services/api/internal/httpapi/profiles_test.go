package httpapi

import (
	"testing"
	"time"
)

func TestQuestionDayStartsAtNine(t *testing.T) {
	cairo, err := time.LoadLocation("Africa/Cairo")
	if err != nil {
		t.Skip("no tzdata")
	}
	at := func(s string) time.Time {
		v, _ := time.ParseInLocation("2006-01-02 15:04", s, cairo)
		return v
	}
	for _, c := range []struct{ now, day, next string }{
		{"2026-11-17 08:59", "2026-11-16", "2026-11-17 09:00"},
		{"2026-11-17 09:00", "2026-11-17", "2026-11-18 09:00"},
		{"2026-11-17 23:30", "2026-11-17", "2026-11-18 09:00"},
	} {
		day, next := questionDay(at(c.now), cairo)
		if day.Format("2006-01-02") != c.day || !next.Equal(at(c.next)) {
			t.Errorf("questionDay(%s) = %s, %s; want %s, %s", c.now, day.Format("2006-01-02"), next.In(cairo).Format("2006-01-02 15:04"), c.day, c.next)
		}
	}
}
