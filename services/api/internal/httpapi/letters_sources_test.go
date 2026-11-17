package httpapi

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"

	"jobbos/api/internal/store"
)

type lettersStub struct {
	Store
	unlocks         []store.Letter
	recap           store.LettersRecap
	from, to        time.Time
	sawPlaceholders bool
}

func (s *lettersStub) LetterUnlocks(_ context.Context, _ uuid.UUID, placeholders bool, from, to time.Time) ([]store.Letter, error) {
	s.from, s.to, s.sawPlaceholders = from, to, placeholders
	return s.unlocks, nil
}

func (s *lettersStub) LettersRecap(_ context.Context, from, to time.Time) (store.LettersRecap, error) {
	s.from, s.to = from, to
	return s.recap, nil
}

func stubAPI(st *lettersStub) *api {
	return &api{Deps: Deps{Store: st, HomeTZ: cairo, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}}
}

func TestLetterCalendarListsUnlocksInHerTime(t *testing.T) {
	id, author := uuid.New(), uuid.New()
	unlock := at("2027-10-01 00:00")
	st := &lettersStub{unlocks: []store.Letter{{ID: id, AuthorID: author, Kind: "time_locked", Occasion: "Birthday", UnlockAt: &unlock}}}
	a := stubAPI(st)
	member := &store.User{ID: uuid.New(), Role: "member"}
	events, err := letterCalendar(context.Background(), a, member, at("2027-09-30 15:00"), at("2027-10-01 08:00"))
	if err != nil {
		t.Fatal(err)
	}
	if !st.from.Equal(at("2027-09-30 00:00")) || !st.to.Equal(at("2027-10-02 00:00")) {
		t.Errorf("queried %v to %v, want whole days in her time", st.from, st.to)
	}
	if st.sawPlaceholders {
		t.Error("the member's calendar asked for placeholders")
	}
	want := CalendarEvent{ID: "letter:" + id.String(), Kind: "letter_unlock", Title: "Birthday", Date: "2027-10-01", Time: "00:00",
		Link: "/letters/?id=" + id.String(), AuthorID: author.String()}
	if len(events) != 1 || events[0] != want {
		t.Errorf("events %+v, want %+v", events, want)
	}
	if _, err := letterCalendar(context.Background(), a, &store.User{ID: uuid.New(), Role: "admin"}, at("2027-09-30 00:00"), at("2027-09-30 00:00")); err != nil || !st.sawPlaceholders {
		t.Error("the admin's calendar should include placeholders")
	}
}

func TestLetterRecapCountsEachPerson(t *testing.T) {
	me, her := uuid.New(), uuid.New()
	st := &lettersStub{recap: store.LettersRecap{
		Letters:       map[uuid.UUID]int{me: 2, her: 3},
		Notes:         map[uuid.UUID]int{me: 4},
		PromisesKept:  map[uuid.UUID]int{},
		SongsOfTheDay: map[uuid.UUID]int{her: 1},
	}}
	figures, err := letterRecap(context.Background(), stubAPI(st), &store.User{ID: me}, at("2026-12-01 00:00"), at("2027-01-01 00:00"))
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]int{}
	for _, f := range figures {
		got[f.Key] = f.Value
	}
	want := map[string]int{"letters_written": 5, "notes_written": 4, "promises_kept": 0, "songs_of_the_day": 1}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %d, want %d", k, got[k], v)
		}
	}
	if d, ok := figures[0].Detail.(map[string]int); !ok || d[her.String()] != 3 || d[me.String()] != 2 {
		t.Errorf("letters detail %v", figures[0].Detail)
	}
	if st.from.Location() != cairo {
		t.Error("recap dates should be in her time zone")
	}
}
