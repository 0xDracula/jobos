package store

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func TestAudioViewAnalysisOnlyInSingleTrackViews(t *testing.T) {
	list, err := json.Marshal(AudioView{URL: "/api/media/x.m4a"})
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"energy", "valence", "danceability", "key"} {
		if strings.Contains(string(list), `"`+key+`"`) {
			t.Errorf("list view has %s: %s", key, list)
		}
	}
	energy, key := float32(0.5), "A minor"
	single, err := json.Marshal(AudioView{URL: "/api/media/x.m4a", AudioAnalysis: &AudioAnalysis{Energy: &energy, Key: &key}})
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(single, &got); err != nil {
		t.Fatal(err)
	}
	if got["energy"] != 0.5 || got["key"] != "A minor" {
		t.Errorf("single view: %s", single)
	}
	for _, k := range []string{"valence", "danceability"} {
		if v, ok := got[k]; !ok || v != nil {
			t.Errorf("single view %s = %v (present %v), want null", k, v, ok)
		}
	}
}

func TestAnalysisFieldsValidate(t *testing.T) {
	f := func(v float64) *float64 { return &v }
	version, badVersion := int32(AnalyzerVersion), int32(0)
	key, longKey := "F♯ minor", strings.Repeat("x", 21)
	ok := []AnalysisFields{
		{},
		{TempoBPM: f(120), Energy: f(0), Valence: f(1), Danceability: f(0.5), MusicalKey: &key, AnalysisVersion: &version},
	}
	for i, a := range ok {
		if err := a.Validate(); err != nil {
			t.Errorf("ok %d: %v", i, err)
		}
	}
	invalid := []AnalysisFields{
		{Energy: f(1.2)},
		{Valence: f(-0.1)},
		{Danceability: f(math.NaN())},
		{TempoBPM: f(0)},
		{MusicalKey: &longKey},
		{AnalysisVersion: &badVersion},
	}
	for i, a := range invalid {
		if err := a.Validate(); err == nil {
			t.Errorf("invalid %d accepted", i)
		}
	}
}
