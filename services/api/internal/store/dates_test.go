package store

import (
	"testing"

	"github.com/google/uuid"
)

func TestDateInputClearsWhatTheKindDoesNotUse(t *testing.T) {
	playlist, person := uuid.New(), uuid.New()
	nine, hour := "21:00", 60
	in := DateInput{Kind: "plan", Label: " Call ", Date: "2026-11-28", Time: &nine, Note: "Bring tea", PlaylistID: &playlist,
		Decorations: []string{"balloons", "balloons"}, UserID: &person, RemindMinutes: &hour}
	if err := in.Validate(); err != nil {
		t.Fatal(err)
	}
	if in.Label != "Call" || len(in.Decorations) != 0 || in.PlaylistID != nil || in.UserID != nil || in.Note != "Bring tea" || in.Time == nil {
		t.Errorf("plan keeps its time and note only: %+v", in)
	}

	in = DateInput{Kind: "birthday", Label: "Birthday", Date: "2026-10-01", Time: &nine, Note: "x", UserID: &person, PlaylistID: &playlist,
		Decorations: []string{"balloons", "balloons", "string_flags"}}
	if err := in.Validate(); err != nil {
		t.Fatal(err)
	}
	if !in.Recurring || in.Time != nil || in.Note != "" || in.UserID == nil || in.PlaylistID == nil || len(in.Decorations) != 2 {
		t.Errorf("birthday repeats yearly, without time or note, with its person, playlist and decorations: %+v", in)
	}

	for _, bad := range []DateInput{
		{Kind: "holiday", Label: "x", Date: "2026-12-01"},
		{Kind: "plan", Label: "", Date: "2026-12-01"},
		{Kind: "plan", Label: "x", Date: "2026-02-30"},
		{Kind: "other", Label: "x", Date: "2026-12-01", Decorations: []string{"confetti"}},
	} {
		if err := bad.Validate(); err == nil {
			t.Errorf("accepted %+v", bad)
		}
	}
}
