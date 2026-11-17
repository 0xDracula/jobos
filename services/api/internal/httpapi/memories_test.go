package httpapi

import (
	"image"
	"image/color"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRecapDays(t *testing.T) {
	cairo, _ := time.LoadLocation("Africa/Cairo")
	from := time.Date(2026, 11, 1, 0, 0, 0, 0, cairo)
	to := time.Date(2026, 12, 1, 0, 0, 0, 0, cairo)
	if a, b := recapDays(from, to, cairo); a != "2026-11-01" || b != "2026-11-30" {
		t.Errorf("exclusive end: %s to %s", a, b)
	}
	if a, b := recapDays(from, from, cairo); a != "2026-11-01" || b != "2026-11-01" {
		t.Errorf("empty period: %s to %s", a, b)
	}
}

func TestMemoryInputsAreValidated(t *testing.T) {
	h := testServer()
	for path, body := range map[string]string{
		"/api/memories":     `{"date": "2026-13-01", "title": "x"}`,
		"/api/places":       `{"name": "x", "lat": 0, "lon": 0}`,
		"/api/chapters":     `{"title": ""}`,
		"/api/glossary":     `{"term": "x", "kind": "pun"}`,
		"/api/photo-albums": `{"name": " "}`,
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, path, strings.NewReader(body)))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", path, rec.Code)
		}
	}
}

func TestUploadPhotoNeedsAnImage(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/photos", strings.NewReader("--x\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.gif\"\r\n\r\nGIF89a\r\n--x--\r\n"))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=x")
	testServer().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("GIF upload: status %d, want 400", rec.Code)
	}
}

func TestMapTilesServeRanges(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("MAP_DIR", dir)
	h := testServer()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/map/tiles.pmtiles", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("before make map: status %d, want 404", rec.Code)
	}
	if err := os.WriteFile(filepath.Join(dir, "cairo.pmtiles"), []byte("PMTiles\x03 and the rest"), 0o644); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/map/tiles.pmtiles", nil)
	req.Header.Set("Range", "bytes=0-6")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusPartialContent || rec.Body.String() != "PMTiles" || rec.Header().Get("ETag") == "" {
		t.Errorf("range: status %d, body %q, etag %q", rec.Code, rec.Body.String(), rec.Header().Get("ETag"))
	}
	for path, want := range map[string]int{
		"/api/map/fonts/Noto%20Sans%20Regular/0-255.pbf":      http.StatusOK,
		"/api/map/fonts/Comic%20Sans/0-255.pbf":               http.StatusNotFound,
		"/api/map/fonts/Noto%20Sans%20Regular/..%2Fx.pbf":     http.StatusNotFound,
		"/api/map/fonts/Noto%20Sans%20Regular/0-255.json":     http.StatusNotFound,
		"/api/map/fonts/Noto%20Sans%20Regular/0-25555555.pbf": http.StatusNotFound,
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != want {
			t.Errorf("%s: status %d, want %d", path, rec.Code, want)
		}
	}
}

func TestPlaceholderImageHelpers(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 640, 480))
	for y := 0; y < 480; y++ {
		for x := 0; x < 640; x++ {
			c := color.RGBA{0x1c, 0x1a, 0x3d, 255}
			if y > 360 {
				c = color.RGBA{0xe8, 0x8f, 0xa3, 255}
			}
			img.Set(x, y, c)
		}
	}
	if b := scaleNearest(img, 300).Bounds(); b.Dx() != 300 || b.Dy() != 225 {
		t.Errorf("scaled to %v, want 300x225", b)
	}
	colors := dominantColors(img, 5)
	if len(colors) != 2 || colors[0].Hex != "#1c1a3d" || colors[0].Weight < 0.7 {
		t.Errorf("colors %+v", colors)
	}
}
