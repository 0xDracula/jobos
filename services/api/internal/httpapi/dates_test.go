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

type fakeStore struct {
	Store
	settings map[string]json.RawMessage
	members  []store.User
	dates    []store.ImportantDate
	notes    []store.RecapNote
	totals   map[uuid.UUID]store.ListeningTotals
	sent     map[string]bool
}

func (f *fakeStore) AppSetting(_ context.Context, key string) (json.RawMessage, error) {
	return f.settings[key], nil
}
func (f *fakeStore) Members(context.Context) ([]store.User, error) { return f.members, nil }
func (f *fakeStore) ImportantDates(_ context.Context, kinds []string, withPlaceholders bool) ([]store.ImportantDate, error) {
	var out []store.ImportantDate
	for _, d := range f.dates {
		match := len(kinds) == 0
		for _, k := range kinds {
			match = match || d.Kind == k
		}
		if match && (withPlaceholders || !d.Placeholder) {
			out = append(out, d)
		}
	}
	return out, nil
}
func (f *fakeStore) MarkReminderSent(_ context.Context, id string, on time.Time, user uuid.UUID) (bool, error) {
	key := id + on.Format("2006-01-02") + user.String()
	if f.sent[key] {
		return false, nil
	}
	f.sent[key] = true
	return true, nil
}
func (f *fakeStore) ListeningTotals(_ context.Context, user uuid.UUID, _ store.Window, _ string) (store.ListeningTotals, error) {
	return f.totals[user], nil
}
func (f *fakeStore) TopTracks(context.Context, uuid.UUID, store.Window, int) ([]store.PlayedTrack, error) {
	return []store.PlayedTrack{{TrackView: store.TrackView{ID: uuid.New(), Title: "Ghir Enta"}, Plays: 4}}, nil
}
func (f *fakeStore) TopArtists(context.Context, uuid.UUID, store.Window, int) ([]store.ArtistPlays, error) {
	return []store.ArtistPlays{{ID: uuid.New(), Name: "Souad Massi", Plays: 4}}, nil
}
func (f *fakeStore) TopTags(context.Context, uuid.UUID, store.Window, int) ([]store.TagWeight, error) {
	return []store.TagWeight{{Name: "folk", Weight: 2}}, nil
}
func (f *fakeStore) HourMinutes(context.Context, uuid.UUID, store.Window, string) ([24]int, error) {
	var h [24]int
	h[22] = 30
	return h, nil
}
func (f *fakeStore) ListeningDays(context.Context, uuid.UUID, *time.Time, string) ([]string, error) {
	return []string{"2026-11-01", "2026-11-02", "2026-11-03"}, nil
}
func (f *fakeStore) Stars(context.Context, time.Time) ([]store.Star, error) {
	at := time.Date(2026, 12, 10, 12, 0, 0, 0, time.UTC)
	return []store.Star{{ID: "card:1", Kind: "card", At: at}, {ID: "note:1", Kind: "note", At: at}, {ID: "swap:1", Kind: "swap", At: at}}, nil
}
func (f *fakeStore) TogetherMinutes(context.Context, uuid.UUID, uuid.UUID, store.Window) (int, error) {
	return 42, nil
}
func (f *fakeStore) BothLiked(context.Context, uuid.UUID, uuid.UUID, store.Window, int) ([]store.TrackView, int, error) {
	return []store.TrackView{}, 3, nil
}
func (f *fakeStore) TasteProfile(_ context.Context, user uuid.UUID) (store.TasteProfile, error) {
	return store.TasteProfile{Artists: map[string]float64{"a": 3, user.String(): 1}, Tags: map[string]float64{"folk": 2}}, nil
}
func (f *fakeStore) SharedTopTracks(context.Context, uuid.UUID, uuid.UUID, store.Window, int) ([]store.SharedTrack, error) {
	return []store.SharedTrack{{TrackView: store.TrackView{ID: uuid.New(), Title: "Shared"}}}, nil
}
func (f *fakeStore) RecapNotes(_ context.Context, period string, starts time.Time, withPlaceholders bool) ([]store.RecapNote, error) {
	var out []store.RecapNote
	for _, n := range f.notes {
		if n.Period == period && n.StartsOn == starts.Format("2006-01-02") && (withPlaceholders || !n.Placeholder) {
			out = append(out, n)
		}
	}
	return out, nil
}

var (
	owner   = store.User{ID: uuid.MustParse("01900000-0000-7000-8000-00000000000a"), Role: "admin", DisplayName: "owner"}
	partner = store.User{ID: uuid.MustParse("01900000-0000-7000-8000-00000000000b"), Role: "member", DisplayName: "Partner"}
)

func cairo(t *testing.T) *time.Location {
	loc, err := time.LoadLocation("Africa/Cairo")
	if err != nil {
		t.Skip("no tzdata")
	}
	return loc
}

func day(s string) time.Time {
	d, _ := parseDay(s)
	return d
}

func newFakeAPI(t *testing.T, f *fakeStore) *api {
	if f.sent == nil {
		f.sent = map[string]bool{}
	}
	return &api{Deps: Deps{Store: f, HomeTZ: cairo(t)}}
}

func swapSources(t *testing.T, cal map[string]calendarSource, rec map[string]recapSource) {
	oldCal, oldRec := calendarSources, recapSources
	calendarSources, recapSources = cal, rec
	t.Cleanup(func() { calendarSources, recapSources = oldCal, oldRec })
}

func TestOccurrences(t *testing.T) {
	got := occurrences(day("2026-08-04"), true, day("2025-01-01"), day("2028-12-31"))
	if len(got) != 3 || dayString(got[0]) != "2026-08-04" || dayString(got[2]) != "2028-08-04" {
		t.Errorf("anniversary occurrences %v, want 2026 to 2028", got)
	}
	leap := occurrences(day("2028-02-29"), true, day("2029-01-01"), day("2029-12-31"))
	if len(leap) != 1 || dayString(leap[0]) != "2029-02-28" {
		t.Errorf("29 February in a common year: %v, want 28 February", leap)
	}
	if got := occurrences(day("2026-12-03"), false, day("2026-12-01"), day("2026-12-31")); len(got) != 1 {
		t.Errorf("one-off date in range: %v", got)
	}
	if got := occurrences(day("2026-12-03"), false, day("2026-12-04"), day("2026-12-31")); len(got) != 0 {
		t.Errorf("one-off date before the range: %v", got)
	}
	if next, ok := nextOccurrence(day("2026-10-01"), true, day("2026-11-17")); !ok || dayString(next) != "2027-10-01" {
		t.Errorf("next birthday %v", next)
	}
	if _, ok := nextOccurrence(day("2026-11-01"), false, day("2026-11-17")); ok {
		t.Error("a past one-off date has no next occurrence")
	}
}

func TestCalendarConsumesEverySource(t *testing.T) {
	a := newFakeAPI(t, &fakeStore{})
	swapSources(t, map[string]calendarSource{
		"letters": func(context.Context, *api, *store.User, time.Time, time.Time) ([]CalendarEvent, error) {
			return []CalendarEvent{
				{ID: "letter:1", Kind: "letter_unlock", Title: "Birthday letter", Date: "2026-10-01", Time: "06:00", AuthorID: owner.ID.String()},
				{ID: "letter:2", Kind: "letter_unlock", Title: "Placeholder: a letter", Date: "2026-10-01", Placeholder: true},
				{ID: "letter:3", Kind: "letter_unlock", Title: "Out of range", Date: "2026-12-01"},
			}, nil
		},
		"surprises": func(context.Context, *api, *store.User, time.Time, time.Time) ([]CalendarEvent, error) {
			return []CalendarEvent{{ID: "s:1", Kind: "countdown", Title: "Visit", Date: "2026-10-01", Surprise: true, Link: "/x", AuthorID: owner.ID.String()}}, nil
		},
		"broken": func(context.Context, *api, *store.User, time.Time, time.Time) ([]CalendarEvent, error) {
			return nil, errors.New("down")
		},
	}, nil)

	her := a.calendarEvents(context.Background(), &partner, "2026-10-01", "2026-10-31")
	if len(her) != 2 {
		t.Fatalf("her events %+v, want the letter and the surprise", her)
	}
	if her[0].ID != "s:1" || her[0].Title != "" || her[0].Link != "" || !her[0].Surprise {
		t.Errorf("a surprise for her keeps only its date and mark: %+v", her[0])
	}
	if her[1].ID != "letter:1" {
		t.Errorf("events without a time come first: %+v", her)
	}
	mine := a.calendarEvents(context.Background(), &owner, "2026-10-01", "2026-10-31")
	if len(mine) != 3 {
		t.Fatalf("admin events %+v, want the placeholder too", mine)
	}
	for _, ev := range mine {
		if ev.ID == "s:1" && ev.Title != "Visit" {
			t.Errorf("the author sees the surprise's title: %+v", ev)
		}
	}
}

func TestDateSourcesAndMilestoneSurprise(t *testing.T) {
	f := &fakeStore{
		settings: map[string]json.RawMessage{"milestones": json.RawMessage(`{"start":"2099-12-03"}`)},
		dates: []store.ImportantDate{
			{ID: uuid.New(), Kind: "birthday", Label: "Partner's birthday", Date: "2026-10-01", Recurring: true, AuthorID: &owner.ID},
			{ID: uuid.New(), Kind: "plan", Label: "Placeholder: a plan", Date: "2027-10-02", Placeholder: true, AuthorID: &owner.ID},
		},
	}
	a := newFakeAPI(t, f)
	swapSources(t, map[string]calendarSource{"dates": dateEvents("birthday", "plan"), "milestones": milestoneEvents}, nil)
	her := a.calendarEvents(context.Background(), &partner, "2027-09-01", "2100-01-31")
	for _, ev := range her {
		if ev.Kind == "milestone" {
			t.Errorf("milestones show before the first one: %+v", ev)
		}
		if ev.Placeholder {
			t.Errorf("placeholder for her: %+v", ev)
		}
	}
	if len(her) == 0 || her[0].Title != "Partner's birthday" || her[0].Date != "2027-10-01" {
		t.Errorf("birthday recurs: %+v", her)
	}
	mine := a.calendarEvents(context.Background(), &owner, "2099-12-01", "2099-12-31")
	if len(mine) != 1 || mine[0].ID != "milestone:together" || !mine[0].Surprise || mine[0].Title != "Back together" {
		t.Errorf("admin sees the first milestone as a surprise: %+v", mine)
	}
}

func TestUpcomingCountdowns(t *testing.T) {
	twenty := "20:00"
	list := upcomingCountdowns([]store.ImportantDate{
		{ID: uuid.New(), Kind: "countdown", Label: "Later", Date: "2027-01-10", AuthorID: &partner.ID},
		{ID: uuid.New(), Kind: "countdown", Label: "Visit", Date: "2026-12-03", Surprise: true, AuthorID: &owner.ID, Time: &twenty},
		{ID: uuid.New(), Kind: "countdown", Label: "Past", Date: "2026-11-01", AuthorID: &owner.ID},
	}, day("2026-11-17"), &partner)
	if len(list) != 2 {
		t.Fatalf("countdowns %+v", list)
	}
	if list[0].Days != 16 || list[0].Title != "" || !list[0].Surprise || list[0].Editable {
		t.Errorf("nearest is the surprise, 16 days, title hidden from her: %+v", list[0])
	}
	if list[1].Title != "Later" || !list[1].Editable {
		t.Errorf("her own countdown: %+v", list[1])
	}
}

func TestDueReminders(t *testing.T) {
	loc := cairo(t)
	day1, hour := 1440, 60
	nine := "21:00"
	birthday := store.ImportantDate{ID: uuid.New(), Kind: "birthday", Date: "2026-10-01", Recurring: true, RemindMinutes: &day1}
	at := func(s string) time.Time {
		v, _ := time.ParseInLocation("2006-01-02 15:04", s, loc)
		return v
	}
	if got := dueReminders(birthday, at("2027-09-30 09:10"), loc); len(got) != 1 || dayString(got[0].On) != "2027-10-01" {
		t.Errorf("a day before at 09:00: %+v", got)
	}
	if got := dueReminders(birthday, at("2027-09-30 08:59"), loc); len(got) != 0 {
		t.Errorf("not yet: %+v", got)
	}
	if got := dueReminders(birthday, at("2027-09-30 10:01"), loc); len(got) != 0 {
		t.Errorf("past the window: %+v", got)
	}
	plan := store.ImportantDate{ID: uuid.New(), Kind: "plan", Date: "2026-11-28", Time: &nine, RemindMinutes: &hour}
	got := dueReminders(plan, at("2026-11-28 20:00"), loc)
	if len(got) != 1 || reminderWhen(got[0], true, at("2026-11-28 20:00"), loc) != "Today, 21:00" {
		t.Errorf("an hour before 21:00: %+v", got)
	}
}

func TestReminderRecipients(t *testing.T) {
	members := []store.User{owner, partner}
	surprise := store.ImportantDate{Kind: "countdown", Surprise: true, AuthorID: &owner.ID}
	if got := reminderRecipients(surprise, members); len(got) != 1 || got[0].ID != owner.ID {
		t.Errorf("a surprise reminds its author only: %+v", got)
	}
	birthday := store.ImportantDate{Kind: "birthday", UserID: &partner.ID}
	if got := reminderRecipients(birthday, members); len(got) != 1 || got[0].ID != owner.ID {
		t.Errorf("her birthday reminds him: %+v", got)
	}
	if got := reminderRecipients(store.ImportantDate{Kind: "plan"}, members); len(got) != 2 {
		t.Errorf("a plan reminds both: %+v", got)
	}
}

func TestSendCalendarRemindersOnce(t *testing.T) {
	day1 := 1440
	f := &fakeStore{members: []store.User{owner, partner}, dates: []store.ImportantDate{
		{ID: uuid.New(), Kind: "anniversary", Label: "Anniversary", Date: "2026-08-04", Recurring: true, RemindMinutes: &day1},
	}}
	a := newFakeAPI(t, f)
	now := time.Date(2027, 8, 3, 9, 30, 0, 0, a.homeTZ())
	SendCalendarReminders(context.Background(), a.Deps, now)
	SendCalendarReminders(context.Background(), a.Deps, now.Add(5*time.Minute))
	if len(f.sent) != 2 {
		t.Errorf("reminders recorded %v, want one per person", f.sent)
	}
}
