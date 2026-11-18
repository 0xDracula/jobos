package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jobbos/api/internal/realtime"
	"jobbos/api/internal/store"
)

type LettersStore interface {
	Letters(ctx context.Context, viewer uuid.UUID, placeholders bool) ([]store.Letter, error)
	Letter(ctx context.Context, id, viewer uuid.UUID, placeholders bool) (store.Letter, error)
	CreateLetter(ctx context.Context, authorID uuid.UUID, recipient *uuid.UUID, in store.LetterInput) (store.Letter, error)
	UpdateLetter(ctx context.Context, id, authorID uuid.UUID, in store.LetterInput) (store.Letter, bool, error)
	DeleteLetter(ctx context.Context, id, authorID uuid.UUID) error
	OpenLetter(ctx context.Context, id, viewer uuid.UUID) error
	WelcomeLetter(ctx context.Context, viewer uuid.UUID, placeholders bool) (*store.Letter, error)
	SetWelcomeLetter(ctx context.Context, authorID uuid.UUID, title, body string) (store.Letter, error)
	DueLetterUnlocks(ctx context.Context) ([]store.Letter, error)
	LetterUnlocks(ctx context.Context, viewer uuid.UUID, placeholders bool, from, to time.Time) ([]store.Letter, error)
	Jar(ctx context.Context, viewer uuid.UUID, day string, placeholders bool) (store.Jar, error)
	OpenJar(ctx context.Context, viewer uuid.UUID, day string, placeholders bool) (store.Note, error)
	WindowNotes(ctx context.Context, viewer uuid.UUID, kind string, placeholders bool) ([]store.Note, error)
	NotesWritten(ctx context.Context, authorID uuid.UUID, placeholders bool) ([]store.Note, error)
	AddNote(ctx context.Context, authorID uuid.UUID, recipient *uuid.UUID, in store.NoteEdit) (store.Note, error)
	EditNote(ctx context.Context, id, authorID uuid.UUID, in store.NoteEdit) (store.Note, error)
	RemoveNote(ctx context.Context, id, authorID uuid.UUID) error
	DailyNotesLeft(ctx context.Context) ([]store.NotesLeft, error)
	Promises(ctx context.Context, placeholders bool) ([]store.Promise, error)
	CreatePromise(ctx context.Context, authorID uuid.UUID, in store.PromiseInput) (store.Promise, error)
	UpdatePromise(ctx context.Context, id, authorID uuid.UUID, in store.PromiseInput) (store.Promise, error)
	DeletePromise(ctx context.Context, id, authorID uuid.UUID) error
	SongPicks(ctx context.Context, placeholders bool) ([]store.SongPick, error)
	AddSongPick(ctx context.Context, authorID, trackID uuid.UUID) error
	RemoveSongPick(ctx context.Context, authorID, trackID uuid.UUID) error
	PickUses(ctx context.Context, authorID uuid.UUID, placeholders bool) ([]store.PickUse, error)
	SongOfTheDayOn(ctx context.Context, authorID uuid.UUID, date string, placeholders bool) (*store.SongOfTheDay, error)
	SongsOfTheDay(ctx context.Context, authorID uuid.UUID, through string, placeholders bool) ([]store.SongOfTheDay, error)
	SetSongOfTheDay(ctx context.Context, authorID uuid.UUID, date string, trackID uuid.UUID, note string) error
	AutoSongOfTheDay(ctx context.Context, authorID uuid.UUID, date string, trackID uuid.UUID) (*store.SongOfTheDay, error)
	DeleteSongOfTheDay(ctx context.Context, authorID uuid.UUID, date string) error
	HandwritingFonts(ctx context.Context) ([]store.HandwritingFont, error)
	SetHandwritingFont(ctx context.Context, userID uuid.UUID, name, path string) (store.HandwritingFont, error)
	DeleteHandwritingFont(ctx context.Context, userID uuid.UUID) error
	HandwritingFontFile(ctx context.Context, sha string) (string, error)
	LettersRecap(ctx context.Context, from, to time.Time) (store.LettersRecap, error)
	SeedLetters(ctx context.Context, authorID uuid.UUID, seed store.LettersSeed) error
	LettersPlaceholders(ctx context.Context) (map[string]int, error)
}

func (a *api) registerLettersRoutes(r chi.Router) {
	r.Get("/letters", a.letterList)
	r.Post("/letters", a.createLetter)
	r.Get("/letters/{id}", a.letter)
	r.Put("/letters/{id}", a.updateLetter)
	r.Delete("/letters/{id}", a.deleteLetter)
	r.Post("/letters/{id}/open", a.openLetter)
	r.Get("/welcome", a.welcome)
	r.Post("/welcome/seen", a.welcomeSeen)

	r.Get("/jar", a.jar)
	r.Post("/jar/open", a.openJar)
	r.Get("/notes/now", a.windowNote)
	r.Get("/notes/written", a.notesWritten)
	r.Post("/notes", a.addNote)
	r.Put("/notes/{id}", a.editNote)
	r.Delete("/notes/{id}", a.removeNote)

	r.Get("/promises", a.promises)
	r.Post("/promises", a.createPromise)
	r.Put("/promises/{id}", a.updatePromise)
	r.Delete("/promises/{id}", a.deletePromise)

	r.Get("/picks", a.picks)
	r.Put("/picks/{trackID}", a.addPick)
	r.Delete("/picks/{trackID}", a.removePick)
	r.Get("/song-of-the-day", a.songOfTheDay)
	r.Put("/song-of-the-day", a.setSongOfTheDay)
	r.Delete("/song-of-the-day/{date}", a.deleteSongOfTheDay)

	r.Get("/fonts", a.fonts)
	r.Get("/fonts/{file}", a.fontFile)

	if a.Store != nil && a.Hub != nil {
		a.watchLetterUnlocks()
	}
}

func (a *api) registerLettersAdminRoutes(r chi.Router) {
	r.Get("/letters", a.adminLetters)
	r.Put("/welcome", a.setWelcome)
	r.Post("/fonts/{userID}", a.uploadFont)
	r.Delete("/fonts/{userID}", a.deleteFont)
}

func init() {
	registerPlaceholders(placeholderSet{
		Name:  "letters",
		Label: "Letters and notes",
		Seed:  seedLetters,
		Count: func(ctx context.Context, a *api) (int, error) {
			counts, err := a.Store.LettersPlaceholders(ctx)
			n := 0
			for _, c := range counts {
				n += c
			}
			return n, err
		},
		Admin: "/admin/#gift",
	})
	registerCalendarSource("letters", letterCalendar)
	registerRecapSource("letters", letterRecap)
}

func (a *api) lettersChanged(ctx context.Context, what ...string) {
	a.broadcast(ctx, realtime.NewEvent("letters.update", map[string]any{"lists": what}))
}

func (a *api) otherMember(ctx context.Context, me uuid.UUID) *uuid.UUID {
	if id, ok := a.recipient(ctx, me); ok {
		return &id
	}
	return nil
}

func (a *api) displayName(ctx context.Context, id uuid.UUID) string {
	if u := a.member(ctx, id); u != nil {
		return u.DisplayName
	}
	return ""
}

const (
	dayLayout    = "2006-01-02"
	noteDayStart = 6
)

func unlockAt(date, hm string, loc *time.Location) (time.Time, error) {
	return time.ParseInLocation(dayLayout+" 15:04", date+" "+hm, loc)
}

func noteDay(t time.Time, loc *time.Location) string {
	return t.In(loc).Add(-noteDayStart * time.Hour).Format(dayLayout)
}

func nextNoteAt(t time.Time, loc *time.Location) time.Time {
	l := t.In(loc)
	next := time.Date(l.Year(), l.Month(), l.Day(), noteDayStart, 0, 0, 0, loc)
	if !next.After(l) {
		next = time.Date(l.Year(), l.Month(), l.Day()+1, noteDayStart, 0, 0, 0, loc)
	}
	return next
}

func noteWindow(t time.Time, loc *time.Location) (kind, day string, ends, next time.Time) {
	l := t.In(loc)
	at := func(dayOffset, hour int) time.Time {
		return time.Date(l.Year(), l.Month(), l.Day()+dayOffset, hour, 0, 0, 0, loc)
	}
	switch h := l.Hour(); {
	case h < 4:
		return "night", at(-1, 0).Format(dayLayout), at(0, 4), at(0, 5)
	case h < 5:
		return "", "", time.Time{}, at(0, 5)
	case h < 11:
		return "morning", l.Format(dayLayout), at(0, 11), at(0, 21)
	case h < 21:
		return "", "", time.Time{}, at(0, 21)
	default:
		return "night", l.Format(dayLayout), at(1, 4), at(1, 5)
	}
}

func dayNumber(day string) int64 {
	t, err := time.Parse(dayLayout, day)
	if err != nil {
		return 0
	}
	return t.Unix() / 86400
}

func windowPick(pool []store.Note, day string) *store.Note {
	if len(pool) == 0 {
		return nil
	}
	n := dayNumber(day) % int64(len(pool))
	return &pool[n]
}

func nextYearly(monthDay, hm string, t time.Time, loc *time.Location) (time.Time, error) {
	l := t.In(loc)
	at, err := time.ParseInLocation("2006-01-02 15:04", fmt.Sprintf("%d-%s %s", l.Year(), monthDay, hm), loc)
	if err != nil {
		return at, err
	}
	if !at.After(l) {
		at = at.AddDate(1, 0, 0)
	}
	return at, nil
}

func autoPick(uses []store.PickUse, date string) (uuid.UUID, bool) {
	if len(uses) == 0 {
		return uuid.Nil, false
	}
	last := func(u store.PickUse) string {
		if u.LastUsed == nil {
			return ""
		}
		return *u.LastUsed
	}
	oldest := last(uses[0])
	for _, u := range uses[1:] {
		if l := last(u); l < oldest {
			oldest = l
		}
	}
	var group []store.PickUse
	for _, u := range uses {
		if last(u) == oldest {
			group = append(group, u)
		}
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(date))
	return group[h.Sum32()%uint32(len(group))].TrackID, true
}

func (a *api) localUnlock(l *store.Letter) {
	if l.UnlockAt != nil {
		t := l.UnlockAt.In(a.homeTZ())
		l.UnlockDate, l.UnlockTime = t.Format(dayLayout), t.Format("15:04")
	}
}

func letterLabel(l store.Letter) string {
	switch {
	case l.Occasion != "":
		return l.Occasion
	case l.Title != "":
		return l.Title
	default:
		return "Letter"
	}
}

func (a *api) letterList(w http.ResponseWriter, r *http.Request) {
	list, err := a.Store.Letters(r.Context(), uid(r), seesPlaceholders(r))
	if err != nil {
		a.serverError(w, "letters", err)
		return
	}
	for i := range list {
		a.localUnlock(&list[i])
	}
	if list == nil {
		list = []store.Letter{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"letters": list, "time_zone": a.homeTZ().String()})
}

func (a *api) letter(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "letter")
	if !ok {
		return
	}
	l, err := a.Store.Letter(r.Context(), id, uid(r), seesPlaceholders(r))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "letter not found")
		return
	}
	if err != nil {
		a.serverError(w, "letter", err)
		return
	}
	a.localUnlock(&l)
	writeJSON(w, http.StatusOK, l)
}

func (a *api) readLetter(w http.ResponseWriter, r *http.Request) (store.LetterInput, bool) {
	var in store.LetterInput
	if !readJSON(w, r, &in) {
		return in, false
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return in, false
	}
	if in.Kind == "time_locked" {
		t, err := unlockAt(in.UnlockDate, in.UnlockTime, a.homeTZ())
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid unlock date or time")
			return in, false
		}
		in.UnlockAt = &t
	}
	return in, true
}

func (a *api) letterDelivered(ctx context.Context, me *store.User, l store.Letter) {
	if l.Status != "published" || l.Kind == "time_locked" || l.Placeholder {
		return
	}
	for _, to := range a.letterRecipients(ctx, l) {
		a.notify(to, "letters", me.DisplayName, letterLabel(l), "/letters/?id="+l.ID.String())
	}
}

func (a *api) letterRecipients(ctx context.Context, l store.Letter) []uuid.UUID {
	if l.RecipientID != nil {
		return []uuid.UUID{*l.RecipientID}
	}
	var out []uuid.UUID
	for _, u := range a.others(ctx, l.AuthorID) {
		out = append(out, u.ID)
	}
	return out
}

func (a *api) letterError(w http.ResponseWriter, what string, err error) {
	switch {
	case errors.Is(err, store.ErrMissingRef):
		writeError(w, http.StatusBadRequest, "song or playlist not found")
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "letter not found")
	case errors.Is(err, store.ErrLocked):
		writeError(w, http.StatusConflict, "letter is locked")
	default:
		a.serverError(w, what, err)
	}
}

func (a *api) createLetter(w http.ResponseWriter, r *http.Request) {
	in, ok := a.readLetter(w, r)
	if !ok {
		return
	}
	me := currentUser(r)
	l, err := a.Store.CreateLetter(r.Context(), me.ID, a.otherMember(r.Context(), me.ID), in)
	if err != nil {
		a.letterError(w, "create letter", err)
		return
	}
	a.localUnlock(&l)
	a.letterDelivered(r.Context(), me, l)
	a.lettersChanged(r.Context(), "letters")
	writeJSON(w, http.StatusCreated, l)
}

func (a *api) updateLetter(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "letter")
	if !ok {
		return
	}
	in, ok := a.readLetter(w, r)
	if !ok {
		return
	}
	me := currentUser(r)
	l, published, err := a.Store.UpdateLetter(r.Context(), id, me.ID, in)
	if err != nil {
		a.letterError(w, "update letter", err)
		return
	}
	a.localUnlock(&l)
	if published {
		a.letterDelivered(r.Context(), me, l)
	}
	a.lettersChanged(r.Context(), "letters")
	writeJSON(w, http.StatusOK, l)
}

func (a *api) deleteLetter(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "letter")
	if !ok {
		return
	}
	if err := a.Store.DeleteLetter(r.Context(), id, uid(r)); err != nil {
		a.letterError(w, "delete letter", err)
		return
	}
	a.lettersChanged(r.Context(), "letters")
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) openLetter(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "letter")
	if !ok {
		return
	}
	l, err := a.Store.Letter(r.Context(), id, uid(r), seesPlaceholders(r))
	if err != nil {
		a.letterError(w, "letter", err)
		return
	}
	if l.AuthorID == uid(r) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err := a.Store.OpenLetter(r.Context(), id, uid(r)); err != nil {
		a.letterError(w, "open letter", err)
		return
	}
	if l.OpenedAt == nil {
		a.lettersChanged(r.Context(), "letters")
	}
	w.WriteHeader(http.StatusNoContent)
}

const welcomeSeenKey = "welcome.seen"

func (a *api) welcome(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	me := uid(r)
	l, err := a.Store.WelcomeLetter(ctx, me, seesPlaceholders(r))
	if err != nil {
		a.serverError(w, "welcome letter", err)
		return
	}
	raw, err := a.Store.UserSetting(ctx, me, welcomeSeenKey)
	if err != nil {
		a.serverError(w, "welcome seen", err)
		return
	}
	var song *store.TrackView
	var cfg OurSong
	if a.setting(ctx, "our_song", &cfg) && cfg.TrackID != nil {
		tracks, err := a.Store.TracksByID(ctx, []uuid.UUID{*cfg.TrackID})
		if err != nil {
			a.serverError(w, "our song", err)
			return
		}
		if len(tracks) > 0 {
			song = &tracks[0]
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"letter": l, "seen": raw != nil || (l != nil && l.AuthorID == me), "song": song})
}

func (a *api) welcomeSeen(w http.ResponseWriter, r *http.Request) {
	raw, _ := json.Marshal(map[string]time.Time{"at": time.Now()})
	a.noContent(w, "welcome seen", a.Store.SetSetting(r.Context(), uid(r), welcomeSeenKey, raw))
}

func (a *api) setWelcome(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Title string `json:"title"`
		Body  string `json:"body"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	in.Title, in.Body = strings.TrimSpace(in.Title), strings.TrimRight(in.Body, " \n\t")
	if utf8.RuneCountInString(in.Title) > 120 || strings.TrimSpace(in.Body) == "" || utf8.RuneCountInString(in.Body) > 20000 {
		writeError(w, http.StatusBadRequest, "a title of 120 characters at most and a body of 1 to 20000")
		return
	}
	l, err := a.Store.SetWelcomeLetter(r.Context(), uid(r), in.Title, in.Body)
	if err != nil {
		a.serverError(w, "save welcome letter", err)
		return
	}
	a.lettersChanged(r.Context(), "welcome", "letters")
	writeJSON(w, http.StatusOK, l)
}

func (a *api) watchLetterUnlocks() {
	go func() {
		tick := time.NewTicker(time.Minute)
		defer tick.Stop()
		for range tick.C {
			a.forEachPair(context.Background(), a.notifyLetterUnlocks)
		}
	}()
}

func (a *api) notifyLetterUnlocks(ctx context.Context) {
	due, err := a.Store.DueLetterUnlocks(ctx)
	if err != nil {
		a.Log.Warn("letter unlocks", "err", err)
		return
	}
	for _, l := range due {
		for _, to := range a.letterRecipients(ctx, l) {
			a.notify(to, "letters", a.displayName(ctx, l.AuthorID), letterLabel(l), "/letters/?id="+l.ID.String())
		}
	}
	if len(due) > 0 {
		a.lettersChanged(ctx, "letters")
	}
}

func (a *api) jar(w http.ResponseWriter, r *http.Request) {
	now := time.Now()
	j, err := a.Store.Jar(r.Context(), uid(r), noteDay(now, a.homeTZ()), seesPlaceholders(r))
	if err != nil {
		a.serverError(w, "jar", err)
		return
	}
	j.NextAt = nextNoteAt(now, a.homeTZ()).Format(time.RFC3339)
	if j.Opened == nil {
		j.Opened = []store.Note{}
	}
	writeJSON(w, http.StatusOK, j)
}

func (a *api) openJar(w http.ResponseWriter, r *http.Request) {
	n, err := a.Store.OpenJar(r.Context(), uid(r), noteDay(time.Now(), a.homeTZ()), seesPlaceholders(r))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "the jar is empty")
		return
	}
	if err != nil {
		a.serverError(w, "open jar", err)
		return
	}
	a.lettersChanged(r.Context(), "jar", "notes")
	writeJSON(w, http.StatusOK, n)
}

func (a *api) windowNote(w http.ResponseWriter, r *http.Request) {
	kind, day, ends, next := noteWindow(time.Now(), a.homeTZ())
	out := map[string]any{"window": nil, "note": nil, "next_at": next}
	if kind != "" {
		pool, err := a.Store.WindowNotes(r.Context(), uid(r), kind, seesPlaceholders(r))
		if err != nil {
			a.serverError(w, "window notes", err)
			return
		}
		out["window"], out["day"], out["ends_at"], out["note"] = kind, day, ends, windowPick(pool, day)
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *api) notesWritten(w http.ResponseWriter, r *http.Request) {
	list, err := a.Store.NotesWritten(r.Context(), uid(r), seesPlaceholders(r))
	if err != nil {
		a.serverError(w, "notes", err)
		return
	}
	if list == nil {
		list = []store.Note{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"notes": list})
}

func (a *api) noteError(w http.ResponseWriter, what string, err error) {
	switch {
	case errors.Is(err, store.ErrMissingRef):
		writeError(w, http.StatusBadRequest, "song not found")
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "note not found")
	default:
		a.serverError(w, what, err)
	}
}

func (a *api) addNote(w http.ResponseWriter, r *http.Request) {
	var in store.NoteEdit
	if !readJSON(w, r, &in) {
		return
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	n, err := a.Store.AddNote(r.Context(), uid(r), a.otherMember(r.Context(), uid(r)), in)
	if err != nil {
		a.noteError(w, "add note", err)
		return
	}
	a.lettersChanged(r.Context(), "jar", "notes")
	writeJSON(w, http.StatusCreated, n)
}

func (a *api) editNote(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "note")
	if !ok {
		return
	}
	var in store.NoteEdit
	if !readJSON(w, r, &in) {
		return
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	n, err := a.Store.EditNote(r.Context(), id, uid(r), in)
	if err != nil {
		a.noteError(w, "edit note", err)
		return
	}
	a.lettersChanged(r.Context(), "jar", "notes")
	writeJSON(w, http.StatusOK, n)
}

func (a *api) removeNote(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "note")
	if !ok {
		return
	}
	if err := a.Store.RemoveNote(r.Context(), id, uid(r)); err != nil {
		a.noteError(w, "remove note", err)
		return
	}
	a.lettersChanged(r.Context(), "jar", "notes")
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) promises(w http.ResponseWriter, r *http.Request) {
	list, err := a.Store.Promises(r.Context(), seesPlaceholders(r))
	if err != nil {
		a.serverError(w, "promises", err)
		return
	}
	if list == nil {
		list = []store.Promise{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"promises": list})
}

func readPromise(w http.ResponseWriter, r *http.Request) (store.PromiseInput, bool) {
	var in store.PromiseInput
	if !readJSON(w, r, &in) {
		return in, false
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return in, false
	}
	return in, true
}

func (a *api) createPromise(w http.ResponseWriter, r *http.Request) {
	in, ok := readPromise(w, r)
	if !ok {
		return
	}
	p, err := a.Store.CreatePromise(r.Context(), uid(r), in)
	if err != nil {
		a.serverError(w, "create promise", err)
		return
	}
	a.lettersChanged(r.Context(), "promises")
	writeJSON(w, http.StatusCreated, p)
}

func (a *api) updatePromise(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "promise")
	if !ok {
		return
	}
	in, ok := readPromise(w, r)
	if !ok {
		return
	}
	p, err := a.Store.UpdatePromise(r.Context(), id, uid(r), in)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "promise not found")
		return
	}
	if err != nil {
		a.serverError(w, "update promise", err)
		return
	}
	a.lettersChanged(r.Context(), "promises")
	writeJSON(w, http.StatusOK, p)
}

func (a *api) deletePromise(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "promise")
	if !ok {
		return
	}
	if err := a.Store.DeletePromise(r.Context(), id, uid(r)); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "promise not found")
		return
	} else if err != nil {
		a.serverError(w, "delete promise", err)
		return
	}
	a.lettersChanged(r.Context(), "promises")
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) picks(w http.ResponseWriter, r *http.Request) {
	list, err := a.Store.SongPicks(r.Context(), seesPlaceholders(r))
	if err != nil {
		a.serverError(w, "picks", err)
		return
	}
	mine, forMe := []store.SongPick{}, []store.SongPick{}
	for _, p := range list {
		if p.Track == nil {
			continue
		}
		if p.AuthorID == uid(r) {
			mine = append(mine, p)
		} else {
			forMe = append(forMe, p)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"mine": mine, "for_me": forMe})
}

func (a *api) addPick(w http.ResponseWriter, r *http.Request) {
	id, ok := trackParam(w, r, "trackID")
	if !ok {
		return
	}
	if err := a.Store.AddSongPick(r.Context(), uid(r), id); errors.Is(err, store.ErrMissingRef) {
		writeError(w, http.StatusNotFound, "song not found")
		return
	} else if err != nil {
		a.serverError(w, "add pick", err)
		return
	}
	a.lettersChanged(r.Context(), "picks", "song-of-the-day")
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) removePick(w http.ResponseWriter, r *http.Request) {
	id, ok := trackParam(w, r, "trackID")
	if !ok {
		return
	}
	if err := a.Store.RemoveSongPick(r.Context(), uid(r), id); err != nil {
		a.serverError(w, "remove pick", err)
		return
	}
	a.lettersChanged(r.Context(), "picks", "song-of-the-day")
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) drawSongOfTheDay(ctx context.Context, authorID uuid.UUID, date string, persist bool) (*store.SongOfTheDay, error) {
	uses, err := a.Store.PickUses(ctx, authorID, false)
	if err != nil {
		return nil, err
	}
	id, ok := autoPick(uses, date)
	if !ok {
		return nil, nil
	}
	if persist {
		return a.Store.AutoSongOfTheDay(ctx, authorID, date, id)
	}
	tracks, err := a.Store.TracksByID(ctx, []uuid.UUID{id})
	if err != nil || len(tracks) == 0 {
		return nil, err
	}
	return &store.SongOfTheDay{AuthorID: authorID, Date: date, TrackID: id, Auto: true, Track: &tracks[0]}, nil
}

func (a *api) songOfTheDay(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	me := uid(r)
	sees := seesPlaceholders(r)
	today := time.Now().In(a.homeTZ()).Format(dayLayout)
	var current *store.SongOfTheDay
	history := []store.SongOfTheDay{}
	for _, o := range a.others(ctx, me) {
		s, err := a.Store.SongOfTheDayOn(ctx, o.ID, today, sees)
		if err == nil && s == nil {
			s, err = a.drawSongOfTheDay(ctx, o.ID, today, true)
		}
		if err != nil {
			a.serverError(w, "song of the day", err)
			return
		}
		if current == nil {
			current = s
		}
		past, err := a.Store.SongsOfTheDay(ctx, o.ID, today, sees)
		if err != nil {
			a.serverError(w, "songs of the day", err)
			return
		}
		history = append(history, past...)
	}
	mine, err := a.Store.SongsOfTheDay(ctx, me, "", sees)
	if err != nil {
		a.serverError(w, "songs of the day", err)
		return
	}
	preview, err := a.Store.SongOfTheDayOn(ctx, me, today, false)
	if err == nil && preview == nil {
		preview, err = a.drawSongOfTheDay(ctx, me, today, false)
	}
	if err != nil {
		a.serverError(w, "song of the day preview", err)
		return
	}
	if mine == nil {
		mine = []store.SongOfTheDay{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"date": today, "today": current, "history": history, "mine": mine, "preview": preview})
}

func (a *api) setSongOfTheDay(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Date    string    `json:"date"`
		TrackID uuid.UUID `json:"track_id"`
		Note    string    `json:"note"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	now := time.Now().In(a.homeTZ())
	today := now.Format(dayLayout)
	if in.Date == "" {
		in.Date = today
	}
	d, err := time.Parse(dayLayout, in.Date)
	if err != nil || in.Date < today || d.After(now.AddDate(1, 0, 0)) {
		writeError(w, http.StatusBadRequest, "date must be YYYY-MM-DD, from today to a year ahead")
		return
	}
	in.Note = strings.TrimSpace(in.Note)
	if utf8.RuneCountInString(in.Note) > 1000 {
		writeError(w, http.StatusBadRequest, "note of 1000 characters at most")
		return
	}
	if err := a.Store.SetSongOfTheDay(r.Context(), uid(r), in.Date, in.TrackID, in.Note); errors.Is(err, store.ErrMissingRef) {
		writeError(w, http.StatusNotFound, "song not found")
		return
	} else if err != nil {
		a.serverError(w, "set song of the day", err)
		return
	}
	a.lettersChanged(r.Context(), "song-of-the-day")
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) deleteSongOfTheDay(w http.ResponseWriter, r *http.Request) {
	date := chi.URLParam(r, "date")
	if _, err := time.Parse(dayLayout, date); err != nil {
		writeError(w, http.StatusNotFound, "song of the day not found")
		return
	}
	if err := a.Store.DeleteSongOfTheDay(r.Context(), uid(r), date); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "song of the day not found")
		return
	} else if err != nil {
		a.serverError(w, "delete song of the day", err)
		return
	}
	a.lettersChanged(r.Context(), "song-of-the-day")
	w.WriteHeader(http.StatusNoContent)
}

const maxFontBytes = 10 << 20

var fontFileRE = regexp.MustCompile(`^([0-9a-f]{64})\.woff2$`)

func (a *api) fonts(w http.ResponseWriter, r *http.Request) {
	list, err := a.Store.HandwritingFonts(r.Context())
	if err != nil {
		a.serverError(w, "fonts", err)
		return
	}
	if list == nil {
		list = []store.HandwritingFont{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"fonts": list})
}

func (a *api) fontFile(w http.ResponseWriter, r *http.Request) {
	m := fontFileRE.FindStringSubmatch(chi.URLParam(r, "file"))
	if m == nil {
		http.NotFound(w, r)
		return
	}
	rel, err := a.Store.HandwritingFontFile(r.Context(), m[1])
	if errors.Is(err, store.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		a.serverError(w, "font", err)
		return
	}
	root, _ := filepath.Abs(a.MediaRoot)
	full := filepath.Join(root, filepath.FromSlash(rel))
	if !strings.HasPrefix(full, root+string(filepath.Separator)) {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(full)
	if err != nil {
		a.serverError(w, "open font", err)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		a.serverError(w, "stat font", err)
		return
	}
	w.Header().Set("Content-Type", "font/woff2")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("ETag", `"`+m[1]+`"`)
	http.ServeContent(w, r, m[1]+".woff2", info.ModTime(), f)
}

func (a *api) uploadFont(w http.ResponseWriter, r *http.Request) {
	userID, err := uuid.Parse(chi.URLParam(r, "userID"))
	if err != nil {
		writeError(w, http.StatusNotFound, "person not found")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxFontBytes+1<<20)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "font must be a form with a file of 10 MB at most")
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "file is required")
		return
	}
	defer file.Close()
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if ext != ".ttf" && ext != ".otf" {
		writeError(w, http.StatusBadRequest, "font must be TTF or OTF")
		return
	}
	path, err := a.saveUpload(file, ext)
	if err != nil {
		a.serverError(w, "save font", err)
		return
	}
	name := filepath.Base(header.Filename)
	if utf8.RuneCountInString(name) > 200 {
		name = string([]rune(name)[:200])
	}
	f, err := a.Store.SetHandwritingFont(r.Context(), userID, name, path)
	if errors.Is(err, store.ErrMissingRef) {
		writeError(w, http.StatusNotFound, "person not found")
		return
	}
	if err != nil {
		a.serverError(w, "set font", err)
		return
	}
	a.lettersChanged(r.Context(), "fonts")
	writeJSON(w, http.StatusAccepted, f)
}

func (a *api) deleteFont(w http.ResponseWriter, r *http.Request) {
	userID, err := uuid.Parse(chi.URLParam(r, "userID"))
	if err != nil {
		writeError(w, http.StatusNotFound, "font not found")
		return
	}
	if err := a.Store.DeleteHandwritingFont(r.Context(), userID); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "font not found")
		return
	} else if err != nil {
		a.serverError(w, "delete font", err)
		return
	}
	a.lettersChanged(r.Context(), "fonts")
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) adminLetters(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	welcome, err := a.Store.WelcomeLetter(ctx, uid(r), true)
	if err != nil {
		a.serverError(w, "welcome letter", err)
		return
	}
	if welcome != nil && welcome.AuthorID != uid(r) {
		welcome = nil
	}
	left, err := a.Store.DailyNotesLeft(ctx)
	if err != nil {
		a.serverError(w, "notes left", err)
		return
	}
	fonts, err := a.Store.HandwritingFonts(ctx)
	if err != nil {
		a.serverError(w, "fonts", err)
		return
	}
	placeholders, err := a.Store.LettersPlaceholders(ctx)
	if err != nil {
		a.serverError(w, "placeholders", err)
		return
	}
	if left == nil {
		left = []store.NotesLeft{}
	}
	if fonts == nil {
		fonts = []store.HandwritingFont{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"welcome": welcome, "daily_left": left, "fonts": fonts, "placeholders": placeholders})
}

func letterCalendar(ctx context.Context, a *api, viewer *store.User, from, to time.Time) ([]CalendarEvent, error) {
	loc := a.homeTZ()
	start := time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, loc)
	end := time.Date(to.Year(), to.Month(), to.Day()+1, 0, 0, 0, 0, loc)
	list, err := a.Store.LetterUnlocks(ctx, viewer.ID, viewer.Role == "admin", start, end)
	if err != nil {
		return nil, err
	}
	out := make([]CalendarEvent, 0, len(list))
	for _, l := range list {
		t := l.UnlockAt.In(loc)
		out = append(out, CalendarEvent{
			ID: "letter:" + l.ID.String(), Kind: "letter_unlock", Title: letterLabel(l),
			Date: t.Format(dayLayout), Time: t.Format("15:04"), Link: "/letters/?id=" + l.ID.String(), AuthorID: l.AuthorID.String(),
		})
	}
	return out, nil
}

func letterRecap(ctx context.Context, a *api, _ *store.User, from, to time.Time) ([]RecapFigure, error) {
	rc, err := a.Store.LettersRecap(ctx, from.In(a.homeTZ()), to.In(a.homeTZ()))
	if err != nil {
		return nil, err
	}
	figure := func(key, label string, by map[uuid.UUID]int) RecapFigure {
		f := RecapFigure{Key: key, Label: label}
		detail := map[string]int{}
		for id, n := range by {
			f.Value += n
			detail[id.String()] = n
		}
		f.Detail = detail
		return f
	}
	return []RecapFigure{
		figure("letters_written", "Letters written", rc.Letters),
		figure("notes_written", "Notes written", rc.Notes),
		figure("promises_kept", "Promises kept", rc.PromisesKept),
		figure("songs_of_the_day", "Songs of the day", rc.SongsOfTheDay),
	}, nil
}

type lettersPlaceholderFile struct {
	Welcome struct {
		Title string `json:"title"`
		Body  string `json:"body"`
	} `json:"welcome"`
	Letters []struct {
		Kind     string `json:"kind"`
		Occasion string `json:"occasion"`
		Title    string `json:"title"`
		Body     string `json:"body"`
		Unlock   string `json:"unlock"`
	} `json:"letters"`
	Notes []struct {
		Kind string `json:"kind"`
		Body string `json:"body"`
	} `json:"notes"`
	Promises []string `json:"promises"`
	Picks    int      `json:"picks"`
}

func seedLetters(ctx context.Context, a *api, raw json.RawMessage) error {
	var f lettersPlaceholderFile
	if err := json.Unmarshal(raw, &f); err != nil {
		return err
	}
	members, err := a.Store.Members(ctx)
	if err != nil {
		return err
	}
	var admin *store.User
	for i := range members {
		if members[i].Role == "admin" {
			admin = &members[i]
			break
		}
	}
	if admin == nil {
		return errors.New("no admin account to write the placeholders")
	}
	seed := store.LettersSeed{Welcome: &store.LetterInput{Title: f.Welcome.Title, Body: f.Welcome.Body}, Promises: f.Promises, Picks: f.Picks}
	for _, l := range f.Letters {
		in := store.LetterInput{Kind: l.Kind, Occasion: l.Occasion, Title: l.Title, Body: l.Body}
		if l.Kind == "time_locked" {
			md, hm, _ := strings.Cut(l.Unlock, " ")
			t, err := nextYearly(md, hm, time.Now(), a.homeTZ())
			if err != nil {
				return fmt.Errorf("letter %q: %w", l.Occasion, err)
			}
			in.UnlockAt = &t
		}
		seed.Letters = append(seed.Letters, in)
	}
	for _, n := range f.Notes {
		seed.Notes = append(seed.Notes, store.NoteEdit{Kind: n.Kind, Body: n.Body})
	}
	return a.Store.SeedLetters(ctx, admin.ID, seed)
}
