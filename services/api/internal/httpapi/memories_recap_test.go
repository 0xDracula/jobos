package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"io/fs"
	"log/slog"
	"regexp"
	"testing"
	"time"

	"github.com/google/uuid"

	"jobbos/api/internal/store"
)

type recapStore struct {
	Store
	counts    store.MemoryCounts
	highlight *store.Memory
	sawAdmin  bool
}

func (s *recapStore) MemoryCounts(_ context.Context, _, _ time.Time, withPlaceholders bool) (store.MemoryCounts, error) {
	s.sawAdmin = withPlaceholders
	return s.counts, nil
}

func (s *recapStore) HighlightedMemory(_ context.Context, _, _ time.Time, _, _ string, _ bool) (*store.Memory, error) {
	return s.highlight, nil
}

func TestMemoriesRecap(t *testing.T) {
	if recapSources["memories"] == nil {
		t.Fatal("memories recap source not registered")
	}
	url, thumb := "/api/media/a.jpg", "/api/media/b.jpg"
	m := &store.Memory{ID: uuid.New(), Title: "Rooftop", Date: "2026-11-03", Photo: &store.Photo{URL: &url, ThumbURL: &thumb}}
	st := &recapStore{counts: store.MemoryCounts{Memories: 2, Photos: 9, Places: 1, Chapters: 0}, highlight: m}
	a := &api{Deps: Deps{Store: st, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}}
	from := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	figures, err := memoriesRecap(context.Background(), a, &store.User{Role: "member"}, from, from.AddDate(0, 1, 0))
	if err != nil {
		t.Fatal(err)
	}
	if st.sawAdmin {
		t.Error("her recap counted placeholders")
	}
	got := map[string]RecapFigure{}
	for _, f := range figures {
		got[f.Key] = f
	}
	if got["memories_added"].Value != 2 || got["photos_added"].Value != 9 || got["places_added"].Value != 1 || got["chapters_added"].Value != 0 {
		t.Errorf("figures %+v", figures)
	}
	h, ok := got["memory_highlight"].Detail.(MemoryHighlight)
	if !ok || h.ID != m.ID || h.PhotoURL == nil || *h.PhotoURL != url || h.Link != "/memories/?id="+m.ID.String() {
		t.Errorf("highlight %+v", got["memory_highlight"])
	}
	st.highlight = nil
	figures, _ = memoriesRecap(context.Background(), a, &store.User{Role: "admin"}, from, from.AddDate(0, 1, 0))
	if !st.sawAdmin || len(figures) != 4 {
		t.Errorf("admin recap without a highlight: %d figures, placeholders %v", len(figures), st.sawAdmin)
	}
}

var settingKey = regexp.MustCompile(`^[a-z][a-z0-9_.]{0,63}$`)

func TestMemoryPlaceholderSets(t *testing.T) {
	names := map[string]bool{}
	for _, s := range placeholderSets {
		names[s.Name] = true
		if !settingKey.MatchString("placeholders." + s.Name) {
			t.Errorf("set %q can't be recorded as an app setting", s.Name)
		}
	}
	for _, name := range []string{"memories", "photo_albums", "places", "story", "glossary", "collections"} {
		if !names[name] {
			t.Errorf("set %s not registered", name)
		}
	}
	images := map[string]bool{}
	read := func(name string, into any) {
		raw, err := fs.ReadFile(placeholderFS, "placeholders/"+name+".json")
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(raw, into); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	var mem struct {
		Memories []struct {
			store.MemoryInput
			Image string `json:"image"`
		} `json:"memories"`
	}
	read("memories", &mem)
	for _, m := range mem.Memories {
		in := m.MemoryInput
		if err := in.Validate(); err != nil {
			t.Errorf("memory %q: %v", m.Title, err)
		}
		images[m.Image] = true
	}
	var albums struct {
		Albums []struct {
			store.AlbumInput
			Photos []struct {
				Image string `json:"image"`
			} `json:"photos"`
		} `json:"albums"`
	}
	read("photo_albums", &albums)
	for _, al := range albums.Albums {
		in := al.AlbumInput
		if err := in.Validate(); err != nil {
			t.Errorf("album %q: %v", al.Name, err)
		}
		for _, p := range al.Photos {
			images[p.Image] = true
		}
	}
	var places struct {
		Places []struct {
			store.PlaceInput
			Image string `json:"image"`
		} `json:"places"`
	}
	read("places", &places)
	for _, p := range places.Places {
		in := p.PlaceInput
		if err := in.Validate(); err != nil {
			t.Errorf("place %q: %v", p.Name, err)
		}
		if p.Lat < 29.82 || p.Lat > 30.20 || p.Lon < 30.88 || p.Lon > 31.56 {
			t.Errorf("place %q outside the map", p.Name)
		}
		images[p.Image] = true
	}
	var story struct {
		Chapters []struct {
			store.ChapterInput
			Images []string `json:"images"`
		} `json:"chapters"`
	}
	read("story", &story)
	for _, c := range story.Chapters {
		in := c.ChapterInput
		if err := in.Validate(); err != nil {
			t.Errorf("chapter %q: %v", c.Title, err)
		}
		for _, img := range c.Images {
			images[img] = true
		}
	}
	var glossary struct {
		Entries []struct {
			store.GlossaryInput
			Image *string `json:"image"`
		} `json:"entries"`
	}
	read("glossary", &glossary)
	for _, e := range glossary.Entries {
		in := e.GlossaryInput
		if err := in.Validate(); err != nil {
			t.Errorf("entry %q: %v", e.Term, err)
		}
		if e.Image != nil {
			images[*e.Image] = true
		}
	}
	for img := range images {
		if img == "" {
			continue
		}
		info, err := fs.Stat(placeholderFS, "placeholders/memories/"+img)
		if err != nil {
			t.Errorf("image %s: %v", img, err)
		} else if info.Size() > 30<<10 {
			t.Errorf("image %s is %d bytes, over 30 KB", img, info.Size())
		}
	}
}
