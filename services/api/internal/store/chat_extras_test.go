package store

import (
	"reflect"
	"testing"
)

func TestSearchTerms(t *testing.T) {
	got := SearchTerms("  100%  a_b  back\\slash one two three four ")
	want := []string{`100\%`, `a\_b`, `back\\slash`, "one", "two"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("SearchTerms = %q, want %q", got, want)
	}
	if SearchTerms("   ") != nil {
		t.Fatal("blank query should give no terms")
	}
}
