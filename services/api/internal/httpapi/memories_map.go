package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"github.com/go-chi/chi/v5"
)

const mapTilesFile = "cairo.pmtiles"

var (
	glyphStacks  = map[string]bool{"Noto Sans Regular": true, "Noto Sans Medium": true, "Noto Sans Italic": true}
	glyphRangeRE = regexp.MustCompile(`^[0-9]{1,5}-[0-9]{1,5}\.pbf$`)
)

func (a *api) mapDir() string {
	if d := os.Getenv("MAP_DIR"); d != "" {
		return d
	}
	return filepath.Join(filepath.Dir(filepath.Clean(a.MediaRoot)), "map")
}

type MapInfo struct {
	Tiles     bool       `json:"tiles"`
	Bytes     int64      `json:"bytes"`
	UpdatedAt *time.Time `json:"updated_at"`
	Build     string     `json:"build,omitempty"`
}

func (a *api) mapInfo() MapInfo {
	var m MapInfo
	info, err := os.Stat(filepath.Join(a.mapDir(), mapTilesFile))
	if err != nil {
		return m
	}
	at := info.ModTime()
	m.Tiles, m.Bytes, m.UpdatedAt = true, info.Size(), &at
	if raw, err := os.ReadFile(filepath.Join(a.mapDir(), "cairo.json")); err == nil {
		var meta struct {
			Build string `json:"build"`
		}
		if json.Unmarshal(raw, &meta) == nil {
			m.Build = meta.Build
		}
	}
	return m
}

func (a *api) mapStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.mapInfo())
}

func (a *api) serveMapFile(w http.ResponseWriter, r *http.Request, rel, mime string) {
	f, err := os.Open(filepath.Join(a.mapDir(), rel))
	if os.IsNotExist(err) {
		writeError(w, http.StatusNotFound, "map data not fetched")
		return
	}
	if err != nil {
		a.serverError(w, "open map data", err)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		a.serverError(w, "stat map data", err)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Header().Set("ETag", fmt.Sprintf(`"%x-%x"`, info.ModTime().UnixNano(), info.Size()))
	http.ServeContent(w, r, filepath.Base(rel), info.ModTime(), f)
}

func (a *api) mapTiles(w http.ResponseWriter, r *http.Request) {
	a.serveMapFile(w, r, mapTilesFile, "application/octet-stream")
}

func (a *api) mapGlyphs(w http.ResponseWriter, r *http.Request) {
	stack, rng := chi.URLParam(r, "stack"), chi.URLParam(r, "range")
	if !glyphStacks[stack] || !glyphRangeRE.MatchString(rng) {
		http.NotFound(w, r)
		return
	}
	if _, err := os.Stat(filepath.Join(a.mapDir(), "fonts", stack, rng)); err != nil {
		w.Header().Set("Content-Type", "application/x-protobuf")
		w.Header().Set("Cache-Control", "private, max-age=86400")
		w.WriteHeader(http.StatusOK)
		return
	}
	a.serveMapFile(w, r, filepath.Join("fonts", stack, rng), "application/x-protobuf")
}
