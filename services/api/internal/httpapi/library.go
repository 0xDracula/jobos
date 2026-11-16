package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jobbos/api/internal/media"
	"jobbos/api/internal/store"
)

const (
	maxUploadBytes = 300 << 20
	maxCoverBytes  = 15 << 20
)

var (
	audioExts = map[string]bool{".mp3": true, ".m4a": true, ".wav": true, ".flac": true, ".ogg": true, ".opus": true}
	imageExts = map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".webp": true}
)

func (a *api) upload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes+maxCoverBytes+1<<20)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "upload must be a form with a file of 300 MB at most")
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "file is required")
		return
	}
	defer file.Close()
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if !audioExts[ext] {
		writeError(w, http.StatusBadRequest, "file must be MP3, M4A, WAV, FLAC or OGG")
		return
	}
	title := strings.TrimSpace(r.FormValue("title"))
	if title == "" {
		title = strings.TrimSuffix(header.Filename, filepath.Ext(header.Filename))
	}
	var artists []string
	for _, n := range strings.Split(r.FormValue("artist"), ",") {
		if n = strings.TrimSpace(n); n != "" {
			artists = append(artists, n)
		}
	}
	edit := store.TrackEdit{Title: &title, Artists: artists}
	if note := r.FormValue("note"); note != "" {
		edit.Note = &note
	}
	if err := edit.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	in := store.UploadInput{Title: title, Artists: artists, Note: r.FormValue("note")}
	if in.Path, err = a.saveUpload(file, ext); err != nil {
		a.serverError(w, "save upload", err)
		return
	}
	if cover, coverHeader, err := r.FormFile("cover"); err == nil {
		defer cover.Close()
		cext := strings.ToLower(filepath.Ext(coverHeader.Filename))
		if !imageExts[cext] || coverHeader.Size > maxCoverBytes {
			writeError(w, http.StatusBadRequest, "cover must be a JPEG, PNG or WebP image of 15 MB at most")
			return
		}
		if in.CoverPath, err = a.saveUpload(cover, cext); err != nil {
			a.serverError(w, "save cover", err)
			return
		}
	}
	trackID, err := a.Store.CreateUpload(r.Context(), in)
	if err != nil {
		a.serverError(w, "create upload", err)
		return
	}
	a.writeTrack(w, r, trackID)
}

func (a *api) saveUpload(src io.Reader, ext string) (string, error) {
	dir := filepath.Join(a.MediaRoot, "uploads")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	name := uuid.NewString() + ext
	f, err := os.Create(filepath.Join(dir, name))
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(f, src); err != nil {
		f.Close()
		return "", err
	}
	return "uploads/" + name, f.Close()
}

func (a *api) updateTrack(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "track not found")
		return
	}
	var e store.TrackEdit
	if !readJSON(w, r, &e) {
		return
	}
	if err := e.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	err = a.Store.UpdateTrack(r.Context(), id, e)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "track not found")
		return
	}
	if err != nil {
		a.serverError(w, "update track", err)
		return
	}
	a.writeTrack(w, r, id)
}

func (a *api) setCover(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "track not found")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxCoverBytes+1<<20)
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "cover must be a form with an image of 15 MB at most")
		return
	}
	defer r.MultipartForm.RemoveAll()
	cover, header, err := r.FormFile("cover")
	if err != nil {
		writeError(w, http.StatusBadRequest, "cover is required")
		return
	}
	defer cover.Close()
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if !imageExts[ext] {
		writeError(w, http.StatusBadRequest, "cover must be a JPEG, PNG or WebP image")
		return
	}
	if _, err := a.Store.Track(r.Context(), id); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "track not found")
		return
	}
	path, err := a.saveUpload(cover, ext)
	if err != nil {
		a.serverError(w, "save cover", err)
		return
	}
	if err := a.Store.EnqueueCover(r.Context(), id, path); err != nil {
		a.serverError(w, "enqueue cover", err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (a *api) prefetch(w http.ResponseWriter, r *http.Request) {
	var in struct {
		TrackIDs []uuid.UUID `json:"track_ids"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if len(in.TrackIDs) == 0 {
		writeError(w, http.StatusBadRequest, "track_ids is required")
		return
	}
	ids := in.TrackIDs
	if len(ids) > 2 {
		ids = ids[:2]
	}
	n, err := a.Store.Prefetch(r.Context(), ids)
	if err != nil {
		a.serverError(w, "prefetch", err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]int{"queued": n})
}

func (a *api) updatePlaylist(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "playlist not found")
		return
	}
	var in struct {
		SyncEnabled *bool `json:"sync_enabled"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.SyncEnabled == nil {
		writeError(w, http.StatusBadRequest, "sync_enabled is required")
		return
	}
	err = a.Store.SetPlaylistSync(r.Context(), id, *in.SyncEnabled)
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "playlist not found")
	case errors.Is(err, store.ErrNotSyncable):
		writeError(w, http.StatusUnprocessableEntity, err.Error())
	case err != nil:
		a.serverError(w, "set playlist sync", err)
	default:
		a.playlist(w, r)
	}
}

func recordingsImport(l *media.Link, link string, recs []store.SourceTrack) store.RecordingsImport {
	in := store.RecordingsImport{Provider: l.Provider, ExternalID: l.ID, URL: link, Name: l.Name, Recordings: recs}
	switch l.Provider {
	case "ytmusic":
		in.Provider, in.URL = "youtube", "https://music.youtube.com/playlist?list="+l.ID
	case "youtube":
		in.Provider, in.URL = "youtube", "https://www.youtube.com/playlist?list="+l.ID
	}
	return in
}

func SyncPlaylists(ctx context.Context, d Deps, every time.Duration) {
	targets, err := d.Store.PlaylistsToSync(ctx, every)
	if err != nil {
		d.Log.Error("playlist sync", "err", err)
		return
	}
	for _, t := range targets {
		l, err := d.Links.Link(ctx, t.URL)
		if err != nil || l.Kind != "playlist" {
			d.Log.Warn("playlist sync", "playlist", t.ID, "err", err)
			continue
		}
		var recs []store.SourceTrack
		if err := json.Unmarshal(l.Recordings, &recs); err != nil {
			d.Log.Warn("playlist sync", "playlist", t.ID, "err", err)
			continue
		}
		sum, err := d.Store.ImportRecordings(ctx, recordingsImport(l, t.URL, recs))
		if err != nil {
			d.Log.Error("playlist sync", "playlist", t.ID, "err", err)
			continue
		}
		d.Log.Info("playlist synced", "playlist", t.ID, "added", sum.Added)
	}
}
