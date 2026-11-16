package store

import "testing"

func TestCleanFavorites(t *testing.T) {
	got, err := CleanFavorites(map[string][]string{"flowers": {" Jasmine ", "jasmine", "", "ياسمين"}, "food": {}})
	if err != nil {
		t.Fatal(err)
	}
	if len(got["flowers"]) != 2 || got["flowers"][0] != "Jasmine" || got["flowers"][1] != "ياسمين" {
		t.Errorf("flowers = %q", got["flowers"])
	}
	if _, ok := got["food"]; ok {
		t.Error("empty category kept")
	}
	if _, err := CleanFavorites(map[string][]string{"cars": {"x"}}); err == nil {
		t.Error("unknown category accepted")
	}
}
