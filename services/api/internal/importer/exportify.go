package importer

import (
	"bufio"
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
	"time"

	"jobbos/api/internal/store"
)

const MaxTracks = 10000

var (
	playlistLinkRE = regexp.MustCompile(`^(?:https?://open\.spotify\.com/(?:intl-[a-z-]+/)?playlist/|spotify:playlist:)([0-9A-Za-z]{22})(?:[/?#].*)?$`)
	trackRefRE     = regexp.MustCompile(`^(?:spotify:track:|https?://open\.spotify\.com/(?:intl-[a-z-]+/)?track/)?([0-9A-Za-z]{22})(?:[/?#].*)?$`)
	artistRefRE    = regexp.MustCompile(`^(?:spotify:artist:)?([0-9A-Za-z]{22})$`)
	albumRefRE     = regexp.MustCompile(`^(?:spotify:album:)?([0-9A-Za-z]{22})$`)
)

func SpotifyPlaylistID(link string) (string, error) {
	m := playlistLinkRE.FindStringSubmatch(strings.TrimSpace(link))
	if m == nil {
		return "", errors.New("not a Spotify playlist link")
	}
	return m[1], nil
}

var exportifyColumns = map[string][]string{
	"uri":         {"track uri", "spotify id"},
	"title":       {"track name"},
	"artists":     {"artist name(s)"},
	"artist_uris": {"artist uri(s)", "artist ids"},
	"album":       {"album name"},
	"album_uri":   {"album uri"},
	"image":       {"album image url"},
	"duration":    {"track duration (ms)", "duration (ms)"},
	"isrc":        {"isrc"},
	"explicit":    {"explicit?", "explicit"},
	"added_at":    {"added at"},
}

func ParseExportify(r io.Reader) ([]store.ImportTrack, int, error) {
	br := bufio.NewReader(r)
	if bom, _ := br.Peek(3); bytes.Equal(bom, []byte("\xef\xbb\xbf")) {
		_, _ = br.Discard(3)
	}
	cr := csv.NewReader(br)
	cr.FieldsPerRecord = -1
	cr.LazyQuotes = true
	header, err := cr.Read()
	if errors.Is(err, io.EOF) {
		return nil, 0, errors.New("the file is empty")
	}
	if err != nil {
		return nil, 0, fmt.Errorf("read CSV: %w", err)
	}
	col := map[string]int{}
	for i, h := range header {
		name := strings.ToLower(strings.TrimSpace(h))
		for key, names := range exportifyColumns {
			for _, n := range names {
				if name == n {
					if _, dup := col[key]; !dup {
						col[key] = i
					}
				}
			}
		}
	}
	for _, key := range []string{"uri", "title", "artists"} {
		if _, ok := col[key]; !ok {
			return nil, 0, fmt.Errorf("not an Exportify CSV: no %q column", exportifyColumns[key][0])
		}
	}
	cell := func(rec []string, key string) string {
		i, ok := col[key]
		if !ok || i >= len(rec) {
			return ""
		}
		return strings.TrimSpace(rec[i])
	}

	var tracks []store.ImportTrack
	skipped := 0
	for line := 2; ; line++ {
		rec, err := cr.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, 0, fmt.Errorf("read CSV line %d: %w", line, err)
		}
		m := trackRefRE.FindStringSubmatch(cell(rec, "uri"))
		title := cell(rec, "title")
		if m == nil || title == "" || len(title) > 500 {
			skipped++
			continue
		}
		if len(tracks) == MaxTracks {
			return nil, 0, fmt.Errorf("more than %d tracks", MaxTracks)
		}
		t := store.ImportTrack{
			SpotifyID: m[1],
			Title:     title,
			Artists:   artists(cell(rec, "artists"), cell(rec, "artist_uris")),
			Album:     cell(rec, "album"),
			ISRC:      strings.ToUpper(cell(rec, "isrc")),
			Explicit:  strings.EqualFold(cell(rec, "explicit"), "true"),
		}
		if am := albumRefRE.FindStringSubmatch(cell(rec, "album_uri")); am != nil {
			t.AlbumSpotifyID = am[1]
		}
		if img := cell(rec, "image"); strings.HasPrefix(img, "https://") {
			t.ArtworkURL = img
		}
		if ms, err := strconv.ParseInt(cell(rec, "duration"), 10, 32); err == nil && ms > 0 {
			t.DurationMs = int32(ms)
		}
		if at, err := time.Parse(time.RFC3339, cell(rec, "added_at")); err == nil {
			t.AddedAt = at
		}
		tracks = append(tracks, t)
	}
	return tracks, skipped, nil
}

func artists(names, uris string) []store.ImportArtist {
	ns := splitList(names)
	var ids []string
	for _, u := range splitList(uris) {
		if m := artistRefRE.FindStringSubmatch(u); m != nil {
			ids = append(ids, m[1])
		}
	}
	out := make([]store.ImportArtist, len(ns))
	for i, n := range ns {
		out[i].Name = n
		if len(ids) == len(ns) {
			out[i].SpotifyID = ids[i]
		}
	}
	return out
}

func splitList(cell string) []string {
	var out []string
	var b strings.Builder
	flush := func() {
		if s := strings.TrimSpace(b.String()); s != "" {
			out = append(out, s)
		}
		b.Reset()
	}
	for i := 0; i < len(cell); i++ {
		switch {
		case cell[i] == '\\' && i+1 < len(cell) && cell[i+1] == ',':
			b.WriteByte(',')
			i++
		case cell[i] == ',':
			flush()
		default:
			b.WriteByte(cell[i])
		}
	}
	flush()
	return out
}
