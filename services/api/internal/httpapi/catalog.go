package httpapi

import (
	"errors"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jobbos/api/internal/store"
)

func (a *api) createPlaylist(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	edit := store.PlaylistEdit{Name: &in.Name, Description: &in.Description}
	if err := edit.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	id, err := a.Store.CreatePlaylist(r.Context(), uid(r), in.Name, in.Description)
	if err != nil {
		a.serverError(w, "create playlist", err)
		return
	}
	view, err := a.Store.Playlist(r.Context(), id)
	if err != nil {
		a.serverError(w, "load playlist", err)
		return
	}
	writeJSON(w, http.StatusCreated, view)
}

func (a *api) deletePlaylist(w http.ResponseWriter, r *http.Request) {
	id, ok := trackParam(w, r, "id")
	if !ok {
		return
	}
	a.noContent(w, "delete playlist", a.Store.DeletePlaylist(r.Context(), id))
}

func (a *api) addToPlaylist(w http.ResponseWriter, r *http.Request) {
	id, ok := trackParam(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		TrackIDs []uuid.UUID `json:"track_ids"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if len(in.TrackIDs) == 0 || len(in.TrackIDs) > 5000 {
		writeError(w, http.StatusBadRequest, "track_ids must hold 1 to 5000 tracks")
		return
	}
	n, err := a.Store.AddToPlaylist(r.Context(), id, uid(r), in.TrackIDs)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		a.serverError(w, "add to playlist", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"added": n})
}

func (a *api) removeFromPlaylist(w http.ResponseWriter, r *http.Request) {
	id, ok := trackParam(w, r, "id")
	if !ok {
		return
	}
	trackID, ok := trackParam(w, r, "trackID")
	if !ok {
		return
	}
	a.noContent(w, "remove from playlist", a.Store.RemoveFromPlaylist(r.Context(), id, trackID))
}

func (a *api) reorderPlaylist(w http.ResponseWriter, r *http.Request) {
	id, ok := trackParam(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		TrackIDs []uuid.UUID `json:"track_ids"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	err := a.Store.ReorderPlaylist(r.Context(), id, in.TrackIDs)
	if errors.Is(err, store.ErrNotPermutation) {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	a.noContent(w, "reorder playlist", err)
}

func (a *api) setPlaylistCover(w http.ResponseWriter, r *http.Request) {
	id, ok := trackParam(w, r, "id")
	if !ok {
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
	if _, err := a.Store.Playlist(r.Context(), id); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "playlist not found")
		return
	}
	path, err := a.saveUpload(cover, ext)
	if err != nil {
		a.serverError(w, "save cover", err)
		return
	}
	if err := a.Store.EnqueuePlaylistCover(r.Context(), id, path); err != nil {
		a.serverError(w, "enqueue cover", err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (a *api) album(w http.ResponseWriter, r *http.Request) {
	id, ok := trackParam(w, r, "id")
	if !ok {
		return
	}
	view, err := a.Store.Album(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "album not found")
		return
	}
	if err != nil {
		a.serverError(w, "load album", err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (a *api) artist(w http.ResponseWriter, r *http.Request) {
	id, ok := trackParam(w, r, "id")
	if !ok {
		return
	}
	view, err := a.Store.Artist(r.Context(), uid(r), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "artist not found")
		return
	}
	if err != nil {
		a.serverError(w, "load artist", err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (a *api) addTopTrack(w http.ResponseWriter, r *http.Request) {
	id, ok := trackParam(w, r, "id")
	if !ok {
		return
	}
	rank, err := strconv.Atoi(chi.URLParam(r, "rank"))
	if err != nil || rank < 1 {
		writeError(w, http.StatusNotFound, "top song not found")
		return
	}
	trackID, err := a.Store.AddTopTrack(r.Context(), id, rank)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "top song not found")
		return
	}
	if err != nil {
		a.serverError(w, "add top song", err)
		return
	}
	view, err := a.Store.Track(r.Context(), trackID)
	if err != nil {
		a.serverError(w, "load track", err)
		return
	}
	if view.Audio != nil || view.StreamURL != nil {
		writeJSON(w, http.StatusOK, view)
		return
	}
	switch {
	case view.Source != nil:
		err = a.enqueueDownload(r.Context(), view.ID, view.Source.ID, view.Source.Provider, view.Source.ExternalID)
	case view.MatchStatus != nil && *view.MatchStatus == "pending":
		err = a.Store.EnqueueMatch(r.Context(), view.ID, store.PriorityInteractive)
	}
	if err != nil {
		a.serverError(w, "enqueue", err)
		return
	}
	writeJSON(w, http.StatusAccepted, view)
}

func (a *api) backfillEnrichment(w http.ResponseWriter, r *http.Request) {
	artists, tracks, err := a.Store.BackfillEnrichment(r.Context())
	if err != nil {
		a.serverError(w, "backfill enrichment", err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]int{"artists": artists, "tracks": tracks})
}

func (a *api) tracksByID(w http.ResponseWriter, r *http.Request) {
	var in struct {
		IDs []uuid.UUID `json:"ids"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if len(in.IDs) == 0 || len(in.IDs) > 5000 {
		writeError(w, http.StatusBadRequest, "ids must hold 1 to 5000 tracks")
		return
	}
	tracks, err := a.Store.TracksByID(r.Context(), in.IDs)
	if err != nil {
		a.serverError(w, "tracks by id", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tracks": tracks})
}

func (a *api) searchLibrary(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" || len(q) > 200 {
		writeError(w, http.StatusBadRequest, "q is required (200 characters at most)")
		return
	}
	tracks, err := a.Store.SearchLibrary(r.Context(), q, intParam(r, "limit", 50, 200))
	if err != nil {
		a.serverError(w, "search library", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tracks": tracks})
}
