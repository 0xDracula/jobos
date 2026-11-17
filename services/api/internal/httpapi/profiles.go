package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jobbos/api/internal/realtime"
	"jobbos/api/internal/store"
)

type ProfilesStore interface {
	Moods(ctx context.Context) ([]store.Mood, error)
	SetMood(ctx context.Context, userID uuid.UUID, mood, note string, until time.Time) (*store.Mood, error)
	ClearMood(ctx context.Context, userID uuid.UUID) error
	QuestionOn(ctx context.Context, day time.Time) (*store.DailyQuestion, error)
	AskedBefore(ctx context.Context, day time.Time, limit int) ([]store.DailyQuestion, error)
	DailyQuestions(ctx context.Context) ([]store.DailyQuestion, error)
	DailyQuestion(ctx context.Context, id uuid.UUID) (*store.DailyQuestion, error)
	CreateDailyQuestion(ctx context.Context, author uuid.UUID, body, kind string) (*store.DailyQuestion, error)
	UpdateDailyQuestion(ctx context.Context, id uuid.UUID, body, kind string) error
	DeleteDailyQuestion(ctx context.Context, id uuid.UUID) error
	OrderDailyQuestions(ctx context.Context, ids []uuid.UUID) error
	DailyAnswers(ctx context.Context, ids []uuid.UUID) ([]store.DailyAnswer, error)
	SetDailyAnswer(ctx context.Context, questionID, userID uuid.UUID, body string, trackID *uuid.UUID) error
	ActivityByDay(ctx context.Context, w store.Window, tz string) ([]store.DayActivity, error)
	MostSkipped(ctx context.Context, userID uuid.UUID, w store.Window, limit int) ([]store.PlayedTrack, error)
	ContentCounts(ctx context.Context, admin uuid.UUID) ([]store.ContentCount, error)
}

func (a *api) registerProfileRoutes(r chi.Router) {
	r.Get("/profiles", a.profiles)
	r.Put("/profile", a.setProfile)
	r.Put("/mood", a.setMood)
	r.Delete("/mood", a.clearMood)
	r.Get("/question", a.question)
	r.Put("/question/{id}/answer", a.answerQuestion)
}

func (a *api) registerProfileAdminRoutes(r chi.Router) {
	r.Get("/questions", a.adminQuestions)
	r.Post("/questions", a.createQuestion)
	r.Put("/questions/order", a.orderQuestions)
	r.Put("/questions/{id}", a.updateQuestion)
	r.Delete("/questions/{id}", a.deleteQuestion)
	r.Get("/listening/timeline", a.listeningTimeline)
	r.Get("/content", a.contentCounts)
}

func (a *api) contentCounts(w http.ResponseWriter, r *http.Request) {
	counts, err := a.Store.ContentCounts(r.Context(), uid(r))
	if err != nil {
		a.serverError(w, "content counts", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"counts": counts})
}

var moodKeys = map[string]bool{"happy": true, "calm": true, "tired": true, "sad": true, "stressed": true, "excited": true, "missing_you": true, "sick": true}

const moodHours = 24

type profileFields struct {
	Nickname        string     `json:"nickname"`
	FavoriteTrackID *uuid.UUID `json:"favorite_track_id"`
	Obsession       string     `json:"obsession"`
}

type profileView struct {
	UserID uuid.UUID `json:"user_id"`
	profileFields
	FavoriteTrack *store.TrackView `json:"favorite_track"`
	Mood          *store.Mood      `json:"mood"`
}

func (a *api) profileOf(ctx context.Context, id uuid.UUID) profileFields {
	var p profileFields
	if raw, err := a.Store.UserSetting(ctx, id, "profile"); err == nil && raw != nil {
		_ = json.Unmarshal(raw, &p)
	}
	return p
}

func (a *api) profiles(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	moods, err := a.Store.Moods(ctx)
	if err != nil {
		a.serverError(w, "moods", err)
		return
	}
	out := []profileView{}
	for _, u := range a.memberList(ctx) {
		v := profileView{UserID: u.ID, profileFields: a.profileOf(ctx, u.ID)}
		if v.FavoriteTrackID != nil {
			if t, err := a.Store.Track(ctx, *v.FavoriteTrackID); err == nil {
				v.FavoriteTrack = t
			}
		}
		for i := range moods {
			if moods[i].UserID == u.ID {
				v.Mood = &moods[i]
			}
		}
		out = append(out, v)
	}
	writeJSON(w, http.StatusOK, map[string]any{"profiles": out})
}

func (a *api) setProfile(w http.ResponseWriter, r *http.Request) {
	var in profileFields
	if !readJSON(w, r, &in) {
		return
	}
	in.Nickname = strings.TrimSpace(in.Nickname)
	in.Obsession = strings.TrimSpace(in.Obsession)
	if utf8.RuneCountInString(in.Nickname) > 40 || utf8.RuneCountInString(in.Obsession) > 200 {
		writeError(w, http.StatusBadRequest, "nickname of 40 and obsession of 200 characters at most")
		return
	}
	if in.FavoriteTrackID != nil {
		if _, err := a.Store.Track(r.Context(), *in.FavoriteTrackID); err != nil {
			writeError(w, http.StatusBadRequest, "track not found")
			return
		}
	}
	raw, _ := json.Marshal(in)
	if err := a.Store.SetSetting(r.Context(), uid(r), "profile", raw); err != nil {
		a.serverError(w, "save profile", err)
		return
	}
	a.broadcast(r.Context(), realtime.NewEvent("profile.update", map[string]any{"user": uid(r)}))
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) setMood(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Mood string `json:"mood"`
		Note string `json:"note"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	in.Note = strings.TrimSpace(in.Note)
	if !moodKeys[in.Mood] || utf8.RuneCountInString(in.Note) > 80 {
		writeError(w, http.StatusBadRequest, "mood must be one of the list, with a note of 80 characters at most")
		return
	}
	m, err := a.Store.SetMood(r.Context(), uid(r), in.Mood, in.Note, time.Now().Add(moodHours*time.Hour))
	if err != nil {
		a.serverError(w, "set mood", err)
		return
	}
	a.broadcast(r.Context(), realtime.NewEvent("profile.update", map[string]any{"user": uid(r)}))
	writeJSON(w, http.StatusOK, m)
}

func (a *api) clearMood(w http.ResponseWriter, r *http.Request) {
	if err := a.Store.ClearMood(r.Context(), uid(r)); err != nil {
		a.serverError(w, "clear mood", err)
		return
	}
	a.broadcast(r.Context(), realtime.NewEvent("profile.update", map[string]any{"user": uid(r)}))
	w.WriteHeader(http.StatusNoContent)
}

const questionHour = 9

func questionDay(now time.Time, loc *time.Location) (day, next time.Time) {
	t := now.In(loc)
	start := time.Date(t.Year(), t.Month(), t.Day(), questionHour, 0, 0, 0, loc)
	if t.Before(start) {
		start = start.AddDate(0, 0, -1)
	}
	return time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.UTC), start.AddDate(0, 0, 1)
}

type answeredQuestion struct {
	store.DailyQuestion
	Mine         *store.DailyAnswer `json:"mine"`
	Theirs       *store.DailyAnswer `json:"theirs"`
	TheyAnswered bool               `json:"they_answered"`
}

func (a *api) withAnswers(ctx context.Context, me uuid.UUID, qs []store.DailyQuestion) ([]answeredQuestion, error) {
	ids := make([]uuid.UUID, len(qs))
	for i, q := range qs {
		ids[i] = q.ID
	}
	answers, err := a.Store.DailyAnswers(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]answeredQuestion, len(qs))
	for i, q := range qs {
		out[i].DailyQuestion = q
		var theirs *store.DailyAnswer
		for j := range answers {
			if answers[j].QuestionID != q.ID {
				continue
			}
			if answers[j].UserID == me {
				out[i].Mine = &answers[j]
			} else {
				theirs = &answers[j]
			}
		}
		out[i].TheyAnswered = theirs != nil
		if out[i].Mine != nil && theirs != nil {
			out[i].Theirs = theirs
		}
	}
	return out, nil
}

func (a *api) question(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	day, next := questionDay(time.Now(), a.homeTZ())
	q, err := a.Store.QuestionOn(ctx, day)
	if err != nil {
		a.serverError(w, "daily question", err)
		return
	}
	var today *answeredQuestion
	if q != nil {
		list, err := a.withAnswers(ctx, uid(r), []store.DailyQuestion{*q})
		if err != nil {
			a.serverError(w, "daily answers", err)
			return
		}
		today = &list[0]
	}
	past, err := a.Store.AskedBefore(ctx, day, intParam(r, "limit", 60, 365))
	if err != nil {
		a.serverError(w, "past questions", err)
		return
	}
	history, err := a.withAnswers(ctx, uid(r), past)
	if err != nil {
		a.serverError(w, "daily answers", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"day": day.Format("2006-01-02"), "today": today, "history": history, "next_at": next})
}

func (a *api) answerQuestion(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "question")
	if !ok {
		return
	}
	var in struct {
		Body    string     `json:"body"`
		TrackID *uuid.UUID `json:"track_id"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	in.Body = strings.TrimSpace(in.Body)
	ctx := r.Context()
	day, _ := questionDay(time.Now(), a.homeTZ())
	q, err := a.Store.QuestionOn(ctx, day)
	if err != nil {
		a.serverError(w, "daily question", err)
		return
	}
	if q == nil || q.ID != id {
		writeError(w, http.StatusConflict, "only today's question takes answers")
		return
	}
	if utf8.RuneCountInString(in.Body) > 2000 || (q.Kind == "text" && in.Body == "") || (q.Kind == "song" && in.TrackID == nil) {
		writeError(w, http.StatusBadRequest, "an answer needs text (2000 characters at most), or a song for a music question")
		return
	}
	if q.Kind == "text" {
		in.TrackID = nil
	} else if _, err := a.Store.Track(ctx, *in.TrackID); err != nil {
		writeError(w, http.StatusBadRequest, "track not found")
		return
	}
	list, err := a.withAnswers(ctx, uid(r), []store.DailyQuestion{*q})
	if err != nil {
		a.serverError(w, "daily answers", err)
		return
	}
	if list[0].Theirs != nil {
		writeError(w, http.StatusConflict, "both answers are revealed")
		return
	}
	if err := a.Store.SetDailyAnswer(ctx, id, uid(r), in.Body, in.TrackID); err != nil {
		a.serverError(w, "answer", err)
		return
	}
	a.broadcast(ctx, realtime.NewEvent("question.update", map[string]any{"question": id, "user": uid(r)}))
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) adminQuestions(w http.ResponseWriter, r *http.Request) {
	list, err := a.Store.DailyQuestions(r.Context())
	if err != nil {
		a.serverError(w, "questions", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"questions": list})
}

func readQuestion(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	var in struct {
		Body string `json:"body"`
		Kind string `json:"kind"`
	}
	if !readJSON(w, r, &in) {
		return "", "", false
	}
	in.Body = strings.TrimSpace(in.Body)
	if in.Kind == "" {
		in.Kind = "text"
	}
	if in.Body == "" || utf8.RuneCountInString(in.Body) > 500 || (in.Kind != "text" && in.Kind != "song") {
		writeError(w, http.StatusBadRequest, "a question needs 1 to 500 characters and the kind text or song")
		return "", "", false
	}
	return in.Body, in.Kind, true
}

func (a *api) createQuestion(w http.ResponseWriter, r *http.Request) {
	body, kind, ok := readQuestion(w, r)
	if !ok {
		return
	}
	q, err := a.Store.CreateDailyQuestion(r.Context(), uid(r), body, kind)
	if err != nil {
		a.serverError(w, "create question", err)
		return
	}
	writeJSON(w, http.StatusCreated, q)
}

func (a *api) updateQuestion(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "question")
	if !ok {
		return
	}
	body, kind, ok := readQuestion(w, r)
	if !ok {
		return
	}
	if err := a.Store.UpdateDailyQuestion(r.Context(), id, body, kind); err != nil {
		a.notFoundOr(w, err, "question")
		return
	}
	a.broadcast(r.Context(), realtime.NewEvent("question.update", map[string]any{"question": id}))
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) deleteQuestion(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "question")
	if !ok {
		return
	}
	if err := a.Store.DeleteDailyQuestion(r.Context(), id); err != nil {
		a.notFoundOr(w, err, "question")
		return
	}
	a.broadcast(r.Context(), realtime.NewEvent("question.update", map[string]any{"question": id}))
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) orderQuestions(w http.ResponseWriter, r *http.Request) {
	var in struct {
		IDs []uuid.UUID `json:"ids"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if len(in.IDs) > 2000 {
		writeError(w, http.StatusBadRequest, "too many questions")
		return
	}
	a.noContent(w, "order questions", a.Store.OrderDailyQuestions(r.Context(), in.IDs))
}

func (a *api) listeningTimeline(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	loc := a.homeTZ()
	days := intParam(r, "days", 14, 90)
	now := time.Now().In(loc)
	from := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, -(days - 1))
	week := now.AddDate(0, 0, -7)
	activity, err := a.Store.ActivityByDay(ctx, store.Window{From: &from}, loc.String())
	if err != nil {
		a.serverError(w, "activity", err)
		return
	}
	type person struct {
		UserID      uuid.UUID           `json:"user_id"`
		TopSongs    []store.PlayedTrack `json:"top_songs"`
		MostSkipped []store.PlayedTrack `json:"most_skipped"`
	}
	people := []person{}
	for _, u := range a.memberList(ctx) {
		top, err := a.Store.TopTracks(ctx, u.ID, store.Window{From: &week}, 5)
		if err != nil {
			a.serverError(w, "top songs", err)
			return
		}
		skipped, err := a.Store.MostSkipped(ctx, u.ID, store.Window{From: &week}, 5)
		if err != nil {
			a.serverError(w, "skips", err)
			return
		}
		people = append(people, person{UserID: u.ID, TopSongs: top, MostSkipped: skipped})
	}
	if activity == nil {
		activity = []store.DayActivity{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"from": from.Format("2006-01-02"), "days": days, "activity": activity, "people": people})
}
