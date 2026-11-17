package store

import (
	"strings"
	"testing"
)

func TestLetterInputValidate(t *testing.T) {
	cases := []struct {
		name string
		in   LetterInput
		ok   bool
	}{
		{"standard", LetterInput{Kind: "standard", Body: "hi"}, true},
		{"welcome is set in admin", LetterInput{Kind: "welcome", Body: "hi"}, false},
		{"open-when needs an occasion", LetterInput{Kind: "open_when", Body: "hi"}, false},
		{"open-when", LetterInput{Kind: "open_when", Occasion: "Open when you miss me", Body: "hi"}, true},
		{"time-locked needs a date", LetterInput{Kind: "time_locked", Body: "hi"}, false},
		{"time-locked", LetterInput{Kind: "time_locked", Body: "hi", UnlockDate: "2027-10-01"}, true},
		{"bad time", LetterInput{Kind: "time_locked", Body: "hi", UnlockDate: "2027-10-01", UnlockTime: "24:00"}, false},
		{"published needs a body", LetterInput{Kind: "standard", Body: "  "}, false},
		{"a draft may be empty", LetterInput{Kind: "standard", Status: "draft"}, true},
		{"unknown status", LetterInput{Kind: "standard", Body: "hi", Status: "sent"}, false},
		{"long occasion", LetterInput{Kind: "open_when", Occasion: strings.Repeat("x", 81), Body: "hi"}, false},
	}
	for _, c := range cases {
		err := c.in.Validate()
		if (err == nil) != c.ok {
			t.Errorf("%s: err %v", c.name, err)
		}
	}
	in := LetterInput{Kind: "time_locked", Body: "hi", UnlockDate: "2027-10-01"}
	_ = in.Validate()
	if in.UnlockTime != "00:00" || in.Status != "published" {
		t.Errorf("defaults: time %q status %q", in.UnlockTime, in.Status)
	}
	in = LetterInput{Kind: "standard", Body: "hi", UnlockDate: "2027-10-01", UnlockTime: "10:00"}
	_ = in.Validate()
	if in.UnlockDate != "" || in.UnlockTime != "" {
		t.Error("only time-locked letters keep an unlock date")
	}
}

func TestNoteAndPromiseValidate(t *testing.T) {
	if err := (&NoteEdit{Kind: "daily", Body: "  "}).Validate(); err == nil {
		t.Error("empty note accepted")
	}
	if err := (&NoteEdit{Kind: "noon", Body: "hi"}).Validate(); err == nil {
		t.Error("unknown kind accepted")
	}
	if err := (&NoteEdit{Kind: "night", Body: "hi"}).Validate(); err != nil {
		t.Error(err)
	}
	empty := ""
	p := PromiseInput{Body: "x", KeptOn: &empty}
	if err := p.Validate(); err != nil || p.KeptOn != nil {
		t.Errorf("an empty kept date clears it: %v %v", err, p.KeptOn)
	}
	bad := "17/11/2026"
	if err := (&PromiseInput{Body: "x", KeptOn: &bad}).Validate(); err == nil {
		t.Error("bad kept date accepted")
	}
}
