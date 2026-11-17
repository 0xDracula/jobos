package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/google/uuid"

	"jobbos/api/internal/store"
)

func init() {
	for _, s := range []placeholderSet{
		{Name: "memories", Label: "Memories", Seed: seedMemories, Admin: "/memories/"},
		{Name: "photo_albums", Label: "Photo albums", Seed: seedPhotoAlbums, Admin: "/albums/"},
		{Name: "places", Label: "Places", Seed: seedPlaces, Admin: "/places/"},
		{Name: "story", Label: "Story book", Seed: seedStory, Admin: "/story/"},
		{Name: "glossary", Label: "Inside jokes and nicknames", Seed: seedGlossary, Admin: "/glossary/"},
		{Name: "collections", Label: "Reminds me of you", Seed: seedCollections, Admin: "/reminds/"},
	} {
		name := s.Name
		s.Count = func(ctx context.Context, a *api) (int, error) { return a.Store.PlaceholderCount(ctx, name) }
		registerPlaceholders(s)
	}
}

type memorySeeder struct {
	a      *api
	admin  uuid.UUID
	tracks []uuid.UUID
	next   int
	assets map[string]store.AssetResult
}

func newMemorySeeder(ctx context.Context, a *api, first int) (*memorySeeder, error) {
	members, err := a.Store.Members(ctx)
	if err != nil {
		return nil, err
	}
	s := &memorySeeder{a: a, assets: map[string]store.AssetResult{}}
	for _, u := range members {
		if u.Role == "admin" {
			s.admin = u.ID
			break
		}
	}
	if s.admin == uuid.Nil {
		return nil, errors.New("no admin account to seed as")
	}
	if s.tracks, err = a.Store.PlaceholderTracks(ctx, 40); err != nil {
		return nil, err
	}
	s.next = first
	return s, nil
}

func (s *memorySeeder) song(want bool) *uuid.UUID {
	if !want || len(s.tracks) == 0 {
		return nil
	}
	id := s.tracks[s.next%len(s.tracks)]
	s.next++
	return &id
}

func (s *memorySeeder) photo(ctx context.Context, albumID *uuid.UUID, name *string, caption string) (*uuid.UUID, error) {
	if name == nil || *name == "" {
		return nil, nil
	}
	asset, err := s.asset(*name)
	if err != nil {
		return nil, err
	}
	id, err := s.a.Store.SeedPhoto(ctx, s.admin, albumID, asset, caption, true)
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func (s *memorySeeder) asset(name string) (store.AssetResult, error) {
	if a, ok := s.assets[name]; ok {
		return a, nil
	}
	if strings.ContainsAny(name, `/\`) || !strings.HasSuffix(name, ".png") {
		return store.AssetResult{}, fmt.Errorf("placeholder image %q must be a PNG in placeholders/memories", name)
	}
	data, err := fs.ReadFile(placeholderFS, "placeholders/memories/"+name)
	if err != nil {
		return store.AssetResult{}, err
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return store.AssetResult{}, fmt.Errorf("%s: %w", name, err)
	}
	sum := sha256.Sum256(data)
	sha := hex.EncodeToString(sum[:])
	rel := fmt.Sprintf("photo/%s/%s/%s.png", sha[:2], sha[2:4], sha)
	full := filepath.Join(s.a.MediaRoot, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return store.AssetResult{}, err
	}
	if _, err := os.Stat(full); err != nil {
		if err := os.WriteFile(full, data, 0o644); err != nil {
			return store.AssetResult{}, err
		}
	}
	thumb := strings.TrimSuffix(full, ".png") + ".300.jpg"
	if _, err := os.Stat(thumb); err != nil {
		var buf bytes.Buffer
		if err := jpeg.Encode(&buf, scaleNearest(img, 300), &jpeg.Options{Quality: 85}); err != nil {
			return store.AssetResult{}, err
		}
		if err := os.WriteFile(thumb, buf.Bytes(), 0o644); err != nil {
			return store.AssetResult{}, err
		}
	}
	palette, _ := json.Marshal(dominantColors(img, 5))
	b := img.Bounds()
	w, h := int32(b.Dx()), int32(b.Dy())
	a := store.AssetResult{SHA256: sha, Path: rel, Kind: "photo", Mime: "image/png", Bytes: int64(len(data)), Width: &w, Height: &h, Palette: palette}
	s.assets[name] = a
	return a, nil
}

func scaleNearest(src image.Image, max int) image.Image {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= max && h <= max {
		return src
	}
	nw, nh := max, h*max/w
	if h > w {
		nw, nh = w*max/h, max
	}
	dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
	for y := 0; y < nh; y++ {
		for x := 0; x < nw; x++ {
			dst.Set(x, y, src.At(b.Min.X+x*w/nw, b.Min.Y+y*h/nh))
		}
	}
	return dst
}

type paletteColor struct {
	Hex    string  `json:"hex"`
	Weight float64 `json:"weight"`
}

func dominantColors(img image.Image, n int) []paletteColor {
	counts := map[string]int{}
	b := img.Bounds()
	total := 0
	for y := b.Min.Y; y < b.Max.Y; y += 2 {
		for x := b.Min.X; x < b.Max.X; x += 2 {
			r, g, bl, _ := img.At(x, y).RGBA()
			counts[fmt.Sprintf("#%02x%02x%02x", r>>8, g>>8, bl>>8)]++
			total++
		}
	}
	out := make([]paletteColor, 0, len(counts))
	for hex, c := range counts {
		out = append(out, paletteColor{Hex: hex, Weight: float64(c) / float64(total)})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Weight != out[j].Weight {
			return out[i].Weight > out[j].Weight
		}
		return out[i].Hex < out[j].Hex
	})
	if len(out) > n {
		out = out[:n]
	}
	for i := range out {
		out[i].Weight = float64(int(out[i].Weight*1000+0.5)) / 1000
	}
	return out
}

func seedMemories(ctx context.Context, a *api, raw json.RawMessage) error {
	var in struct {
		Memories []struct {
			Date    string  `json:"date"`
			Title   string  `json:"title"`
			Caption string  `json:"caption"`
			Image   *string `json:"image"`
			Song    bool    `json:"song"`
		} `json:"memories"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return err
	}
	s, err := newMemorySeeder(ctx, a, 0)
	if err != nil {
		return err
	}
	for _, m := range in.Memories {
		input := store.MemoryInput{Date: m.Date, Title: m.Title, Caption: m.Caption}
		if err := input.Validate(); err != nil {
			return fmt.Errorf("%s: %w", m.Title, err)
		}
		if input.PhotoID, err = s.photo(ctx, nil, m.Image, ""); err != nil {
			return err
		}
		input.TrackID = s.song(m.Song)
		if _, err := a.Store.CreateMemory(ctx, s.admin, input, true); err != nil {
			return err
		}
	}
	return nil
}

func seedPhotoAlbums(ctx context.Context, a *api, raw json.RawMessage) error {
	var in struct {
		Albums []struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			Song        bool   `json:"song"`
			Photos      []struct {
				Image   string `json:"image"`
				Caption string `json:"caption"`
			} `json:"photos"`
		} `json:"albums"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return err
	}
	s, err := newMemorySeeder(ctx, a, 6)
	if err != nil {
		return err
	}
	for _, al := range in.Albums {
		input := store.AlbumInput{Name: al.Name, Description: al.Description}
		if err := input.Validate(); err != nil {
			return fmt.Errorf("%s: %w", al.Name, err)
		}
		input.TrackID = s.song(al.Song)
		id, err := a.Store.CreatePhotoAlbum(ctx, s.admin, input, true)
		if err != nil {
			return err
		}
		for _, p := range al.Photos {
			img := p.Image
			if _, err := s.photo(ctx, &id, &img, p.Caption); err != nil {
				return err
			}
		}
	}
	return nil
}

func seedPlaces(ctx context.Context, a *api, raw json.RawMessage) error {
	var in struct {
		Places []struct {
			store.PlaceInput
			Image *string `json:"image"`
			Song  bool    `json:"song"`
		} `json:"places"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return err
	}
	s, err := newMemorySeeder(ctx, a, 8)
	if err != nil {
		return err
	}
	for _, p := range in.Places {
		input := p.PlaceInput
		if err := input.Validate(); err != nil {
			return fmt.Errorf("%s: %w", p.Name, err)
		}
		if input.PhotoID, err = s.photo(ctx, nil, p.Image, ""); err != nil {
			return err
		}
		input.TrackID = s.song(p.Song)
		if _, err := a.Store.CreatePlace(ctx, s.admin, input, true); err != nil {
			return err
		}
	}
	return nil
}

func seedStory(ctx context.Context, a *api, raw json.RawMessage) error {
	var in struct {
		Chapters []struct {
			Title    string   `json:"title"`
			DateFrom *string  `json:"date_from"`
			DateTo   *string  `json:"date_to"`
			Body     string   `json:"body"`
			Images   []string `json:"images"`
			Song     bool     `json:"song"`
		} `json:"chapters"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return err
	}
	s, err := newMemorySeeder(ctx, a, 13)
	if err != nil {
		return err
	}
	for _, c := range in.Chapters {
		input := store.ChapterInput{Title: c.Title, DateFrom: c.DateFrom, DateTo: c.DateTo, Body: c.Body}
		if err := input.Validate(); err != nil {
			return fmt.Errorf("%s: %w", c.Title, err)
		}
		for _, img := range c.Images {
			img := img
			id, err := s.photo(ctx, nil, &img, "")
			if err != nil {
				return err
			}
			input.PhotoIDs = append(input.PhotoIDs, *id)
		}
		input.TrackID = s.song(c.Song)
		if _, err := a.Store.CreateChapter(ctx, s.admin, input, true); err != nil {
			return err
		}
	}
	return nil
}

func seedGlossary(ctx context.Context, a *api, raw json.RawMessage) error {
	var in struct {
		Entries []struct {
			store.GlossaryInput
			Image *string `json:"image"`
			Song  bool    `json:"song"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return err
	}
	s, err := newMemorySeeder(ctx, a, 17)
	if err != nil {
		return err
	}
	for _, e := range in.Entries {
		input := e.GlossaryInput
		if err := input.Validate(); err != nil {
			return fmt.Errorf("%s: %w", e.Term, err)
		}
		if input.PhotoID, err = s.photo(ctx, nil, e.Image, ""); err != nil {
			return err
		}
		input.TrackID = s.song(e.Song)
		if _, err := a.Store.CreateGlossaryEntry(ctx, s.admin, input, true); err != nil {
			return err
		}
	}
	return nil
}

func seedCollections(ctx context.Context, a *api, raw json.RawMessage) error {
	var in struct {
		Items []struct {
			Reason string `json:"reason"`
		} `json:"items"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return err
	}
	s, err := newMemorySeeder(ctx, a, 21)
	if err != nil {
		return err
	}
	for i, it := range in.Items {
		if i >= len(s.tracks) {
			break
		}
		if _, _, err := a.Store.AddToCollection(ctx, s.admin, s.tracks[len(s.tracks)-1-i], it.Reason, true); err != nil {
			return err
		}
	}
	return nil
}
