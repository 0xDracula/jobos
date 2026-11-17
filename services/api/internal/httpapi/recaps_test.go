package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"jobbos/api/internal/store"
)

func TestStreaks(t *testing.T) {
	days := []string{"2026-11-01", "2026-11-02", "2026-11-03", "2026-11-05", "2026-11-15", "2026-11-16"}
	if got := longestStreak(days); got != 3 {
		t.Errorf("longest %d, want 3", got)
	}
	if got := currentStreak(days, day("2026-11-16")); got != 2 {
		t.Errorf("current on a listening day %d, want 2", got)
	}
	if got := currentStreak(days, day("2026-11-17")); got != 2 {
		t.Errorf("current before listening today %d, want 2 (through yesterday)", got)
	}
	if got := currentStreak(days, day("2026-11-18")); got != 0 {
		t.Errorf("current after a day off %d, want 0", got)
	}
	if longestStreak(nil) != 0 {
		t.Error("no days, no streak")
	}
}

func TestTopHour(t *testing.T) {
	var h [24]int
	if topHour(h) != -1 {
		t.Error("no listening has no top hour")
	}
	h[9], h[22] = 5, 12
	if topHour(h) != 22 {
		t.Errorf("top hour %d, want 22", topHour(h))
	}
}

func TestTasteMatch(t *testing.T) {
	a := store.TasteProfile{Artists: map[string]float64{"massi": 20, "cairokee": 5}, Tags: map[string]float64{"folk": 10, "rock": 3}}
	if got := tasteMatch(a, a); got == nil || *got != 100 {
		t.Errorf("same taste %v, want 100", got)
	}
	b := store.TasteProfile{Artists: map[string]float64{"fairuz": 7}, Tags: map[string]float64{"tarab": 4}}
	if got := tasteMatch(a, b); got == nil || *got != 0 {
		t.Errorf("nothing in common %v, want 0", got)
	}
	c := store.TasteProfile{Artists: map[string]float64{"massi": 2, "fairuz": 9}, Tags: map[string]float64{"folk": 6}}
	got := tasteMatch(a, c)
	if got == nil || *got <= 0 || *got >= 100 {
		t.Errorf("some overlap %v, want between 0 and 100", got)
	}
	if tasteMatch(a, store.TasteProfile{}) != nil {
		t.Error("no match until both have listened")
	}
	if x, y := cosine(map[string]float64{"a": 1000, "b": 10}, map[string]float64{"b": 10}), 0.0; x <= y {
		t.Errorf("damped cosine %v", x)
	}
}

func TestExchangedSongs(t *testing.T) {
	at := func(d string) time.Time { return day(d).Add(12 * time.Hour) }
	stars := []store.Star{
		{ID: "card:1", Kind: "card", At: at("2026-10-30")},
		{ID: "mixtape:1:0", Kind: "mixtape", At: at("2026-11-02")},
		{ID: "mixtape:1:1", Kind: "mixtape", At: at("2026-11-02")},
		{ID: "note:1", Kind: "note", At: at("2026-11-03")},
		{ID: "swap:1", Kind: "swap", At: at("2026-11-20")},
	}
	from, to := day("2026-11-01"), day("2026-12-01")
	got := exchangedSongs(stars, &from, &to, 2)
	if got.Total != 3 || got.ByKind["mixtape"] != 2 || got.ByKind["swap"] != 1 || got.ByKind["note"] != 0 {
		t.Errorf("November exchange %+v", got)
	}
	if len(got.Recent) != 2 || got.Recent[0].ID != "swap:1" {
		t.Errorf("newest first, two at most: %+v", got.Recent)
	}
	if all := exchangedSongs(stars, nil, nil, 10); all.Total != 4 {
		t.Errorf("all time %d, want 4 (notes don't count)", all.Total)
	}
}

func TestRecapPeriods(t *testing.T) {
	anchor := day("2026-12-03")
	if p := yearOf(anchor, day("2026-11-17")); dayString(p.Start) != "2025-12-03" || dayString(p.End) != "2026-12-03" {
		t.Errorf("year containing 17 November 2026: %v – %v", p.Start, p.End)
	}
	if p := yearRelease(anchor, day("2026-11-17")); dayString(p.Start) != "2026-12-03" || dayString(p.End) != "2027-12-03" {
		t.Errorf("first year recap covers 3 December 2026 to 2 December 2027, released on the 3rd: %v – %v", p.Start, p.End)
	}
	if got := releasedYears(anchor, day("2027-12-02")); len(got) != 0 {
		t.Errorf("no year recap before 3 December 2027: %v", got)
	}
	if got := releasedYears(anchor, day("2027-12-03")); len(got) != 1 || dayString(got[0].Start) != "2026-12-03" {
		t.Errorf("the first year recap on 3 December 2027: %v", got)
	}
	months := releasedMonths(day("2026-11-16"), day("2027-01-01"))
	if len(months) != 2 || dayString(months[0].Start) != "2026-12-01" || dayString(months[1].Start) != "2026-11-01" {
		t.Errorf("monthly recaps released on 1 January 2027: %v", months)
	}
	if got := releasedMonths(day("2026-11-16"), day("2026-11-30")); len(got) != 0 {
		t.Errorf("November's recap waits for 1 December: %v", got)
	}
	if _, ok := periodAt("month", "2026-11-02", anchor); ok {
		t.Error("a month starts on the 1st")
	}
	if p, ok := periodAt("year", "2026-12-03", anchor); !ok || dayString(p.last()) != "2027-12-02" {
		t.Errorf("year period %v %v", p, ok)
	}
}

func TestRecapSourcesBecomeSlides(t *testing.T) {
	a := newFakeAPI(t, &fakeStore{})
	var gotFrom, gotTo time.Time
	swapSources(t, nil, map[string]recapSource{
		"letters": func(_ context.Context, _ *api, _ *store.User, from, to time.Time) ([]RecapFigure, error) {
			gotFrom, gotTo = from, to
			return []RecapFigure{{Key: "letters_written", Label: "Letters", Value: 2}}, nil
		},
		"memories": func(context.Context, *api, *store.User, time.Time, time.Time) ([]RecapFigure, error) {
			return []RecapFigure{{Key: "memories_added", Label: "Memories", Value: 1, Detail: RecapHighlight{Title: "The rooftop", PhotoURL: "/api/media/x.jpg"}}}, nil
		},
		"broken": func(context.Context, *api, *store.User, time.Time, time.Time) ([]RecapFigure, error) {
			return nil, errors.New("down")
		},
	})
	figures := a.recapFigures(context.Background(), &partner, "2026-11-01", "2026-11-30")
	if len(figures) != 2 || figures[0].Source != "letters" || figures[1].Source != "memories" {
		t.Fatalf("figures %+v", figures)
	}
	if gotFrom.Format("2006-01-02 15:04") != "2026-11-01 00:00" || gotTo.Format("2006-01-02 15:04") != "2026-11-30 23:59" || gotFrom.Location() != a.homeTZ() {
		t.Errorf("sources get the period's first and last day in her time zone: %v – %v", gotFrom, gotTo)
	}
	slides := figureSlides(figures)
	if len(slides) != 2 || slides[0].Kind != "highlight" || slides[1].Kind != "figures" {
		t.Errorf("slides %+v", slides)
	}
}

func TestRecapPlaceholderHighlightsOnlyForAdmin(t *testing.T) {
	a := newFakeAPI(t, &fakeStore{})
	swapSources(t, nil, map[string]recapSource{
		"memories": func(context.Context, *api, *store.User, time.Time, time.Time) ([]RecapFigure, error) {
			return []RecapFigure{
				{Key: "memories_added", Label: "Memories", Value: 1, Detail: RecapHighlight{Title: "Placeholder: a memory", Placeholder: true}},
				{Key: "milestones", Label: "Milestones", Value: 2, Detail: []RecapHighlight{{Title: "Placeholder", Placeholder: true}, {Title: "30 days"}}},
			}, nil
		},
	})
	her := a.recapFigures(context.Background(), &partner, "2026-11-01", "2026-11-30")
	if her[0].Detail != nil {
		t.Errorf("a placeholder highlight reached her: %+v", her[0].Detail)
	}
	if list, ok := her[1].Detail.([]map[string]any); !ok || len(list) != 1 || list[0]["title"] != "30 days" {
		t.Errorf("placeholder items stay out of her list: %+v", her[1].Detail)
	}
	mine := a.recapFigures(context.Background(), &owner, "2026-11-01", "2026-11-30")
	if mine[0].Detail == nil {
		t.Error("the admin sees placeholder highlights")
	}
}

func recapFake() *fakeStore {
	return &fakeStore{
		settings: map[string]json.RawMessage{"milestones": json.RawMessage(`{"start":"2026-12-03"}`)},
		members:  []store.User{owner, partner},
		totals:   map[uuid.UUID]store.ListeningTotals{partner.ID: {Minutes: 300, Plays: 80, Songs: 40, Days: 12}, owner.ID: {Minutes: 100, Plays: 30}},
		notes: []store.RecapNote{
			{AuthorID: owner.ID, Period: "month", StartsOn: "2026-11-01", Body: "Placeholder: a note", Placeholder: true},
			{AuthorID: partner.ID, Period: "month", StartsOn: "2026-11-01", Body: "For you"},
			{AuthorID: owner.ID, Period: "year", StartsOn: "2026-12-03", Body: "Our year"},
			{AuthorID: partner.ID, Period: "year", StartsOn: "2026-12-03", Body: "Ours"},
		},
	}
}

func kinds(rc Recap) []string {
	var out []string
	for _, s := range rc.Slides {
		out = append(out, s.Kind)
	}
	return out
}

func TestMonthlyRecapSlides(t *testing.T) {
	a := newFakeAPI(t, recapFake())
	swapSources(t, nil, map[string]recapSource{"milestones": milestoneFigures})
	nov := monthOf(day("2026-11-01"))

	rc, err := a.buildRecap(context.Background(), &partner, &partner, nov, nov, false)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"cover", "listening", "top_songs", "top_artists", "together"}
	if got := kinds(rc); len(got) != len(want) || got[len(got)-1] != "together" {
		t.Errorf("her November slides %v, want %v (no note: the placeholder is admin-only)", got, want)
	}
	rc, _ = a.buildRecap(context.Background(), &owner, &owner, nov, nov, false)
	if got := kinds(rc); got[len(got)-1] != "note" || rc.Slides[len(rc.Slides)-1].Data.(noteView).Body != "For you" {
		t.Errorf("his November slides %v", got)
	}
	rc, _ = a.buildRecap(context.Background(), &owner, &partner, nov, nov, true)
	got := kinds(rc)
	if len(rc.Hidden) != 1 || got[1] == "listening" || got[len(got)-1] != "note" || !rc.Slides[len(rc.Slides)-1].Data.(noteView).Placeholder {
		t.Errorf("admin view of her recap %v hidden %v", got, rc.Hidden)
	}
	rc, _ = a.buildRecap(context.Background(), &owner, &owner, nov, nov, true)
	if last := rc.Slides[len(rc.Slides)-1]; last.Kind != "note" || last.Data.(noteView).AuthorID != owner.ID || !rc.Preview {
		t.Errorf("preview of his own recap: %v", kinds(rc))
	}
}

func TestYearRecapSlides(t *testing.T) {
	f := recapFake()
	f.settings["visibility"] = json.RawMessage(`{"listening_history":"shared"}`)
	a := newFakeAPI(t, f)
	swapSources(t, nil, map[string]recapSource{"milestones": milestoneFigures})
	year := yearOf(day("2026-12-03"), day("2026-12-03"))
	rc, err := a.buildRecap(context.Background(), &partner, &partner, year, year, false)
	if err != nil {
		t.Fatal(err)
	}
	got := kinds(rc)
	order := map[string]int{}
	for i, k := range got {
		order[k] = i
	}
	for _, k := range []string{"together_minutes", "shared_songs", "exchanged", "listening", "notes"} {
		if _, ok := order[k]; !ok {
			t.Errorf("year recap %v lacks %s", got, k)
		}
	}
	if got[len(got)-1] != "notes" || len(rc.Slides[len(rc.Slides)-1].Data.(map[string]any)["notes"].([]noteView)) != 2 {
		t.Errorf("closing slide holds a note from each: %v", got)
	}
}
