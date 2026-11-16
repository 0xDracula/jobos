package store

import (
	"reflect"
	"testing"
)

func TestParseLRC(t *testing.T) {
	got, err := ParseLRC("[ar:Souad Massi]\r\n[00:25.09] ديرني في بالك\r\n[01:02.5][00:29.07]ياللي بهواك\n\n[02:00.123]\nuntimed line\n")
	if err != nil {
		t.Fatal(err)
	}
	want := []LyricLine{
		{TimeMs: 25_090, Text: "ديرني في بالك"},
		{TimeMs: 29_070, Text: "ياللي بهواك"},
		{TimeMs: 62_500, Text: "ياللي بهواك"},
		{TimeMs: 120_123, Text: ""},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v\nwant %+v", got, want)
	}
	if _, err := ParseLRC("[ar:x]\nno times here"); err == nil {
		t.Error("text without timestamps accepted")
	}
}

func TestLyricsResultValidate(t *testing.T) {
	lrclib, bad, lrc, junk := "lrclib", "genius", "[00:01.00] a", "not lrc"
	ok := []LyricsResult{
		{},
		{Source: &lrclib, SyncedLRC: &lrc},
		{Source: &lrclib, Instrumental: true},
	}
	for i, r := range ok {
		if err := r.Validate(); err != nil {
			t.Errorf("ok %d: %v", i, err)
		}
	}
	invalid := []LyricsResult{
		{Source: &bad, SyncedLRC: &lrc},
		{SyncedLRC: &lrc},
		{Source: &lrclib, SyncedLRC: &junk},
	}
	for i, r := range invalid {
		if err := r.Validate(); err == nil {
			t.Errorf("invalid %d accepted", i)
		}
	}
}
