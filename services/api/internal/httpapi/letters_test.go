package httpapi

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"jobbos/api/internal/store"
)

var cairo = time.FixedZone("Cairo", 2*3600)

func at(s string) time.Time {
	t, err := time.ParseInLocation("2006-01-02 15:04", s, cairo)
	if err != nil {
		panic(err)
	}
	return t
}

func TestUnlockAtIsHerLocalTime(t *testing.T) {
	got, err := unlockAt("2027-10-01", "00:00", cairo)
	if err != nil {
		t.Fatal(err)
	}
	if want := time.Date(2027, 9, 30, 22, 0, 0, 0, time.UTC); !got.Equal(want) {
		t.Errorf("unlock %v, want %v", got.UTC(), want)
	}
	if _, err := unlockAt("2027-02-30", "00:00", cairo); err == nil {
		t.Error("30 February accepted")
	}
	if loc, err := time.LoadLocation("Africa/Cairo"); err == nil {
		got, err := unlockAt("2027-08-04", "09:30", loc)
		if err != nil || got.In(loc).Format("2006-01-02 15:04") != "2027-08-04 09:30" {
			t.Errorf("Africa/Cairo: %v %v", got, err)
		}
	}
}

func TestNoteDayStartsAtSix(t *testing.T) {
	cases := map[string]string{
		"2026-11-18 05:59": "2026-11-17",
		"2026-11-18 06:00": "2026-11-18",
		"2026-11-18 23:59": "2026-11-18",
		"2026-11-19 00:30": "2026-11-18",
	}
	for now, want := range cases {
		if got := noteDay(at(now), cairo); got != want {
			t.Errorf("%s: note day %s, want %s", now, got, want)
		}
		if got := noteDay(at(now).UTC(), cairo); got != want {
			t.Errorf("%s in UTC: note day %s, want %s", now, got, want)
		}
	}
	next := map[string]string{
		"2026-11-18 05:00": "2026-11-18 06:00",
		"2026-11-18 06:00": "2026-11-19 06:00",
		"2026-11-18 21:00": "2026-11-19 06:00",
	}
	for now, want := range next {
		if got := nextNoteAt(at(now), cairo); !got.Equal(at(want)) {
			t.Errorf("%s: next note %v, want %s", now, got, want)
		}
	}
}

func TestNoteWindows(t *testing.T) {
	cases := []struct {
		now, kind, day, ends, next string
	}{
		{"2026-11-18 04:30", "", "", "", "2026-11-18 05:00"},
		{"2026-11-18 05:00", "morning", "2026-11-18", "2026-11-18 11:00", "2026-11-18 21:00"},
		{"2026-11-18 10:59", "morning", "2026-11-18", "2026-11-18 11:00", "2026-11-18 21:00"},
		{"2026-11-18 11:00", "", "", "", "2026-11-18 21:00"},
		{"2026-11-18 21:00", "night", "2026-11-18", "2026-11-19 04:00", "2026-11-19 05:00"},
		{"2026-11-19 03:59", "night", "2026-11-18", "2026-11-19 04:00", "2026-11-19 05:00"},
		{"2026-11-19 04:00", "", "", "", "2026-11-19 05:00"},
	}
	for _, c := range cases {
		kind, day, ends, next := noteWindow(at(c.now), cairo)
		if kind != c.kind || day != c.day || !next.Equal(at(c.next)) {
			t.Errorf("%s: %q %q next %v, want %q %q next %s", c.now, kind, day, next, c.kind, c.day, c.next)
		}
		if c.ends != "" && !ends.Equal(at(c.ends)) {
			t.Errorf("%s: ends %v, want %s", c.now, ends, c.ends)
		}
	}
}

func TestWindowPickTakesTheNotesInTurn(t *testing.T) {
	if windowPick(nil, "2026-11-18") != nil {
		t.Fatal("a note from an empty pool")
	}
	pool := []store.Note{{Body: "a"}, {Body: "b"}, {Body: "c"}}
	seen := map[string]int{}
	day := at("2026-11-18 12:00")
	for i := 0; i < 6; i++ {
		d := day.AddDate(0, 0, i).Format(dayLayout)
		n := windowPick(pool, d)
		if n2 := windowPick(pool, d); n2.Body != n.Body {
			t.Fatalf("%s: two different notes on one day", d)
		}
		seen[n.Body]++
		if i > 0 && n.Body == windowPick(pool, day.AddDate(0, 0, i-1).Format(dayLayout)).Body {
			t.Errorf("%s: same note as the day before", d)
		}
	}
	for _, b := range []string{"a", "b", "c"} {
		if seen[b] != 2 {
			t.Errorf("note %s shown %d times in 6 days, want 2", b, seen[b])
		}
	}
}

func TestAutoPick(t *testing.T) {
	if _, ok := autoPick(nil, "2026-11-18"); ok {
		t.Fatal("picked from no picks")
	}
	d := func(s string) *string { return &s }
	used, fresh1, fresh2 := uuid.New(), uuid.New(), uuid.New()
	uses := []store.PickUse{{TrackID: used, LastUsed: d("2026-11-10")}, {TrackID: fresh1}, {TrackID: fresh2}}
	got, _ := autoPick(uses, "2026-11-18")
	if got == used {
		t.Error("a used pick came before picks never used")
	}
	if again, _ := autoPick(uses, "2026-11-18"); again != got {
		t.Error("the same date drew a different pick")
	}
	older, newer := uuid.New(), uuid.New()
	uses = []store.PickUse{{TrackID: newer, LastUsed: d("2026-11-17")}, {TrackID: older, LastUsed: d("2026-11-01")}}
	if got, _ := autoPick(uses, "2026-11-18"); got != older {
		t.Error("the pick used longest ago should come next")
	}
}

func TestNextOccurrence(t *testing.T) {
	now := at("2026-11-17 12:00")
	cases := map[string]string{
		"10-01 00:00": "2027-10-01 00:00",
		"08-04 00:00": "2027-08-04 00:00",
		"12-25 08:00": "2026-12-25 08:00",
		"11-17 12:00": "2027-11-17 12:00",
	}
	for in, want := range cases {
		md, hm := in[:5], in[6:]
		got, err := nextOccurrence(md, hm, now, cairo)
		if err != nil || !got.Equal(at(want)) {
			t.Errorf("%s: %v %v, want %s", in, got, err, want)
		}
	}
}

func TestLetterLabel(t *testing.T) {
	if got := letterLabel(store.Letter{Occasion: "Birthday", Title: "x"}); got != "Birthday" {
		t.Errorf("label %q", got)
	}
	if got := letterLabel(store.Letter{}); got != "Letter" {
		t.Errorf("label %q", got)
	}
}
