package httpapi

import (
	"testing"
	"time"
)

func TestMilestonesFromStart(t *testing.T) {
	cairo, _ := time.LoadLocation("Africa/Cairo")
	start := time.Date(2026, 12, 3, 0, 0, 0, 0, cairo)
	day := func(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 12, 0, 0, 0, cairo) }

	if got := milestones(start, day(2026, 12, 2)); len(got) != 0 {
		t.Fatalf("before the start date: %v, want nothing (surprise)", got)
	}
	got := milestones(start, day(2027, 1, 2))
	want := map[string]string{"together": "2026-12-03", "30_days": "2027-01-02", "100_days": "2027-03-13", "1_year": "2027-12-03"}
	for _, m := range got {
		if d, ok := want[m.ID]; ok && d != m.Date {
			t.Errorf("%s on %s, want %s", m.ID, m.Date, d)
		}
	}
	reached := map[string]bool{}
	for _, m := range got {
		reached[m.ID] = m.Reached
	}
	if !reached["together"] || !reached["30_days"] || reached["100_days"] || reached["1_year"] {
		t.Errorf("reached on 2 January 2027: %v", reached)
	}
	later := milestones(start, day(2028, 12, 4))
	if last := later[len(later)-1]; last.ID != "3_years" || last.Reached {
		t.Errorf("last milestone after 2 years: %+v, want 3_years upcoming", last)
	}
}

func TestValidPlantStages(t *testing.T) {
	for _, c := range []struct {
		stages []float64
		ok     bool
	}{
		{[]float64{0, 1, 5, 20, 60}, true},
		{[]float64{0, 0.5, 2, 8, 30}, true},
		{[]float64{1, 2, 5, 20, 60}, false},
		{[]float64{0, 5, 5, 20, 60}, false},
		{[]float64{0, 1, 5, 20}, false},
		{[]float64{0, 1, 5, 20, 200000}, false},
	} {
		if got := validPlantStages(c.stages); got != c.ok {
			t.Errorf("validPlantStages(%v) = %v, want %v", c.stages, got, c.ok)
		}
	}
}
