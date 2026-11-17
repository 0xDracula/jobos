package store

import (
	"testing"

	"github.com/google/uuid"
)

func TestOrderMomentsGroupsSongsByFirstDate(t *testing.T) {
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	moments := []Moment{
		{Kind: "memory", Label: "beach", trackID: b, at: "2026-08-04"},
		{Kind: "chapter", Label: "chapter one", trackID: a, at: "2026-02-14"},
		{Kind: "dedication", Label: "for you", trackID: b, at: "2026-03-01"},
		{Kind: "our_song", Label: "Our song", trackID: c},
		{Kind: "place", Label: "Zamalek", trackID: a, at: "2026-09-05"},
	}
	got := orderMoments(moments)
	if len(got) != 3 {
		t.Fatalf("%d songs, want 3", len(got))
	}
	if got[0][0].Kind != "our_song" {
		t.Errorf("first song from %s, want your song first", got[0][0].Kind)
	}
	if got[1][0].trackID != a || len(got[1]) != 2 || got[1][1].Label != "Zamalek" {
		t.Errorf("second song %+v, want chapter one then Zamalek", got[1])
	}
	if got[2][0].trackID != b || got[2][0].Label != "for you" || got[2][1].Label != "beach" {
		t.Errorf("third song %+v, want its dedication before its memory", got[2])
	}
}

func TestValidDay(t *testing.T) {
	for s, ok := range map[string]bool{"2026-12-03": true, "1900-01-01": true, "2026-02-30": false, "26-12-03": false, "1899-12-31": false, "": false} {
		if ValidDay(s) != ok {
			t.Errorf("ValidDay(%q) = %v, want %v", s, !ok, ok)
		}
	}
}

func TestChapterInputValidate(t *testing.T) {
	p := uuid.New()
	from, to, empty := "2026-04-01", "2026-03-01", ""
	in := ChapterInput{Title: "  One ", DateFrom: &from, DateTo: &empty, PhotoIDs: []uuid.UUID{p, p}}
	if err := in.Validate(); err != nil {
		t.Fatal(err)
	}
	if in.Title != "One" || in.DateTo != nil || len(in.PhotoIDs) != 1 {
		t.Errorf("cleaned input %+v", in)
	}
	bad := ChapterInput{Title: "One", DateFrom: &from, DateTo: &to}
	if bad.Validate() == nil {
		t.Error("end date before start date accepted")
	}
	if (&ChapterInput{Title: " "}).Validate() == nil {
		t.Error("empty title accepted")
	}
}

func TestPlaceInputValidate(t *testing.T) {
	ok := PlaceInput{Name: "Zamalek", Lat: 30.06, Lon: 31.22}
	if err := ok.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, in := range []PlaceInput{
		{Name: "Nowhere", Lat: 0, Lon: 0},
		{Name: "Off the map", Lat: 91, Lon: 31},
		{Name: "", Lat: 30, Lon: 31},
	} {
		if in.Validate() == nil {
			t.Errorf("%+v accepted", in)
		}
	}
}

func TestGlossaryInputValidate(t *testing.T) {
	in := GlossaryInput{Term: "قطتي"}
	if err := in.Validate(); err != nil || in.Kind != "joke" {
		t.Errorf("default kind: %v, %q", err, in.Kind)
	}
	if (&GlossaryInput{Kind: "pun", Term: "x"}).Validate() == nil {
		t.Error("unknown kind accepted")
	}
}

func TestPhotoResultRejectsOtherKinds(t *testing.T) {
	w, h := int32(10), int32(10)
	sha := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	asset := AssetResult{SHA256: sha, Path: "photo/01/23/" + sha + ".jpg", Kind: "photo", Mime: "image/jpeg", Bytes: 10, Width: &w, Height: &h}
	bad := "2026-02-30"
	r := PhotoResult{Original: asset, Display: asset, Thumb: asset, TakenOn: &bad}
	if err := r.Validate(); err != nil {
		t.Fatal(err)
	}
	if r.TakenOn != nil {
		t.Error("invalid taken_on kept")
	}
	r.Thumb.Kind, r.Thumb.Path = "artwork", "artwork/01/23/"+sha+".jpg"
	if r.Validate() == nil {
		t.Error("artwork accepted as a photo")
	}
}
