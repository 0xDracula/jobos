package httpapi

import (
	"context"
	"errors"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jobbos/api/internal/realtime"
	"jobbos/api/internal/store"
)

type MemoriesStore interface {
	CreatePhoto(ctx context.Context, by uuid.UUID, albumID *uuid.UUID, path, caption string) (store.Photo, error)
	Photo(ctx context.Context, id uuid.UUID, withPlaceholders bool) (store.Photo, error)
	UpdatePhoto(ctx context.Context, id uuid.UUID, caption string, takenOn *string, withPlaceholders bool) error
	DeletePhoto(ctx context.Context, id, by uuid.UUID, admin bool) error
	SeedPhoto(ctx context.Context, by uuid.UUID, albumID *uuid.UUID, asset store.AssetResult, caption string, placeholder bool) (uuid.UUID, error)

	PhotoAlbums(ctx context.Context, withPlaceholders bool) ([]store.PhotoAlbum, error)
	PhotoAlbum(ctx context.Context, id uuid.UUID, withPlaceholders bool) (store.PhotoAlbumView, error)
	CreatePhotoAlbum(ctx context.Context, by uuid.UUID, in store.AlbumInput, placeholder bool) (uuid.UUID, error)
	UpdatePhotoAlbum(ctx context.Context, id uuid.UUID, in store.AlbumInput, withPlaceholders bool) error
	DeletePhotoAlbum(ctx context.Context, id, by uuid.UUID, admin bool) error
	ReorderPhotos(ctx context.Context, albumID uuid.UUID, ids []uuid.UUID) error

	Memories(ctx context.Context, withPlaceholders bool, limit int) ([]store.Memory, error)
	Memory(ctx context.Context, id uuid.UUID, withPlaceholders bool) (store.Memory, error)
	CreateMemory(ctx context.Context, by uuid.UUID, in store.MemoryInput, placeholder bool) (uuid.UUID, error)
	UpdateMemory(ctx context.Context, id uuid.UUID, in store.MemoryInput, withPlaceholders bool) error
	DeleteMemory(ctx context.Context, id, by uuid.UUID, admin bool) error

	Places(ctx context.Context, withPlaceholders bool) ([]store.Place, error)
	CreatePlace(ctx context.Context, by uuid.UUID, in store.PlaceInput, placeholder bool) (uuid.UUID, error)
	UpdatePlace(ctx context.Context, id uuid.UUID, in store.PlaceInput, withPlaceholders bool) error
	DeletePlace(ctx context.Context, id, by uuid.UUID, admin bool) error

	Chapters(ctx context.Context, withPlaceholders bool) ([]store.Chapter, error)
	CreateChapter(ctx context.Context, by uuid.UUID, in store.ChapterInput, placeholder bool) (uuid.UUID, error)
	UpdateChapter(ctx context.Context, id uuid.UUID, in store.ChapterInput, withPlaceholders bool) error
	DeleteChapter(ctx context.Context, id, by uuid.UUID, admin bool) error
	ReorderChapters(ctx context.Context, ids []uuid.UUID) error

	CollectionItems(ctx context.Context, withPlaceholders bool) ([]store.CollectionItem, error)
	AddToCollection(ctx context.Context, userID, trackID uuid.UUID, reason string, placeholder bool) (store.CollectionItem, bool, error)
	UpdateCollectionItem(ctx context.Context, id, userID uuid.UUID, reason string) error
	RemoveFromCollection(ctx context.Context, id, userID uuid.UUID) error

	GlossaryEntries(ctx context.Context, withPlaceholders bool) ([]store.GlossaryEntry, error)
	CreateGlossaryEntry(ctx context.Context, by uuid.UUID, in store.GlossaryInput, placeholder bool) (uuid.UUID, error)
	UpdateGlossaryEntry(ctx context.Context, id uuid.UUID, in store.GlossaryInput, withPlaceholders bool) error
	DeleteGlossaryEntry(ctx context.Context, id, by uuid.UUID, admin bool) error

	Soundtrack(ctx context.Context, ourSong *uuid.UUID, tz string, withPlaceholders bool) ([]store.SoundtrackItem, error)
	MemoryCounts(ctx context.Context, from, to time.Time, withPlaceholders bool) (store.MemoryCounts, error)
	HighlightedMemory(ctx context.Context, from, to time.Time, dayFrom, dayTo string, withPlaceholders bool) (*store.Memory, error)
	MemoryTableCounts(ctx context.Context) (map[string]store.TableCount, error)
	PlaceholderTracks(ctx context.Context, n int) ([]uuid.UUID, error)
	PlaceholderCount(ctx context.Context, set string) (int, error)
}

func (a *api) registerMemoriesRoutes(r chi.Router) {
	r.Post("/photos", a.uploadPhoto)
	r.Get("/photos/{id}", a.photo)
	r.Put("/photos/{id}", a.updatePhoto)
	r.Delete("/photos/{id}", a.deletePhoto)

	r.Get("/photo-albums", a.photoAlbums)
	r.Post("/photo-albums", a.createPhotoAlbum)
	r.Get("/photo-albums/{id}", a.photoAlbum)
	r.Put("/photo-albums/{id}", a.updatePhotoAlbum)
	r.Delete("/photo-albums/{id}", a.deletePhotoAlbum)
	r.Put("/photo-albums/{id}/order", a.reorderPhotos)

	r.Get("/memories", a.memories)
	r.Get("/memories/board", a.memoryBoard)
	r.Post("/memories", a.createMemory)
	r.Get("/memories/{id}", a.memory)
	r.Put("/memories/{id}", a.updateMemory)
	r.Delete("/memories/{id}", a.deleteMemory)

	r.Get("/places", a.places)
	r.Post("/places", a.createPlace)
	r.Put("/places/{id}", a.updatePlace)
	r.Delete("/places/{id}", a.deletePlace)
	r.Get("/map", a.mapStatus)
	r.Get("/map/tiles.pmtiles", a.mapTiles)
	r.Get("/map/fonts/{stack}/{range}", a.mapGlyphs)

	r.Get("/chapters", a.chapters)
	r.Post("/chapters", a.createChapter)
	r.Put("/chapters/order", a.reorderChapters)
	r.Put("/chapters/{id}", a.updateChapter)
	r.Delete("/chapters/{id}", a.deleteChapter)

	r.Get("/soundtrack", a.soundtrack)

	r.Get("/collections", a.collections)
	r.Post("/collections", a.addToCollection)
	r.Put("/collections/{id}", a.updateCollectionItem)
	r.Delete("/collections/{id}", a.removeFromCollection)

	r.Get("/glossary", a.glossary)
	r.Post("/glossary", a.createGlossaryEntry)
	r.Put("/glossary/{id}", a.updateGlossaryEntry)
	r.Delete("/glossary/{id}", a.deleteGlossaryEntry)
}

func (a *api) registerMemoriesAdminRoutes(r chi.Router) {
	r.Get("/memories/summary", a.adminMemories)
}

func init() {
	notifyDefaults["reminders"] = true
	registerRecapSource("memories", memoriesRecap)
}

func (a *api) memoriesChanged(ctx context.Context, lists ...string) {
	a.broadcast(ctx, realtime.NewEvent("memories.update", map[string]any{"lists": lists}))
}

func (a *api) notFoundOr(w http.ResponseWriter, err error, what string) {
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, what+" not found")
		return
	}
	a.serverError(w, what, err)
}

const maxPhotoBytes = 40 << 20

var photoExts = map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".webp": true}

func (a *api) uploadPhoto(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxPhotoBytes+1<<20)
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "photo must be a form with an image of 40 MB at most")
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
	if !photoExts[ext] {
		writeError(w, http.StatusBadRequest, "photo must be JPEG, PNG or WebP")
		return
	}
	var albumID *uuid.UUID
	if v := r.FormValue("album_id"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			writeError(w, http.StatusNotFound, "album not found")
			return
		}
		albumID = &id
	}
	caption := strings.TrimSpace(r.FormValue("caption"))
	if len([]rune(caption)) > 500 {
		writeError(w, http.StatusBadRequest, "caption of 500 characters at most")
		return
	}
	path, err := a.saveUpload(file, ext)
	if err != nil {
		a.serverError(w, "save photo", err)
		return
	}
	ctx, ok := a.uploadConversation(w, r)
	if !ok {
		return
	}
	p, err := a.Store.CreatePhoto(ctx, uid(r), albumID, path, caption)
	if err != nil {
		a.notFoundOr(w, err, "album")
		return
	}
	if albumID != nil {
		a.memoriesChanged(r.Context(), "albums")
	}
	writeJSON(w, http.StatusCreated, p)
}

func (a *api) photo(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "photo")
	if !ok {
		return
	}
	p, err := a.Store.Photo(r.Context(), id, seesPlaceholders(r))
	if err != nil {
		a.notFoundOr(w, err, "photo")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (a *api) updatePhoto(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "photo")
	if !ok {
		return
	}
	var in struct {
		Caption string  `json:"caption"`
		TakenOn *string `json:"taken_on"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	in.Caption = strings.TrimSpace(in.Caption)
	if len([]rune(in.Caption)) > 500 {
		writeError(w, http.StatusBadRequest, "caption of 500 characters at most")
		return
	}
	if in.TakenOn != nil && *in.TakenOn == "" {
		in.TakenOn = nil
	}
	if in.TakenOn != nil && !store.ValidDay(*in.TakenOn) {
		writeError(w, http.StatusBadRequest, "date must be YYYY-MM-DD")
		return
	}
	if err := a.Store.UpdatePhoto(r.Context(), id, in.Caption, in.TakenOn, seesPlaceholders(r)); err != nil {
		a.notFoundOr(w, err, "photo")
		return
	}
	a.memoriesChanged(r.Context(), "albums", "memories", "places", "chapters", "glossary")
	a.photo(w, r)
}

func (a *api) deletePhoto(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "photo")
	if !ok {
		return
	}
	if err := a.Store.DeletePhoto(r.Context(), id, uid(r), isAdmin(r)); err != nil {
		a.notFoundOr(w, err, "photo")
		return
	}
	a.memoriesChanged(r.Context(), "albums", "memories", "places", "chapters", "glossary")
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) photoAlbums(w http.ResponseWriter, r *http.Request) {
	list, err := a.Store.PhotoAlbums(r.Context(), seesPlaceholders(r))
	if err != nil {
		a.serverError(w, "albums", err)
		return
	}
	if list == nil {
		list = []store.PhotoAlbum{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"albums": list})
}

func (a *api) photoAlbum(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "album")
	if !ok {
		return
	}
	v, err := a.Store.PhotoAlbum(r.Context(), id, seesPlaceholders(r))
	if err != nil {
		a.notFoundOr(w, err, "album")
		return
	}
	if v.Photos == nil {
		v.Photos = []store.Photo{}
	}
	writeJSON(w, http.StatusOK, v)
}

func (a *api) createPhotoAlbum(w http.ResponseWriter, r *http.Request) {
	var in store.AlbumInput
	if !readJSON(w, r, &in) {
		return
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	id, err := a.Store.CreatePhotoAlbum(r.Context(), uid(r), in, false)
	if err != nil {
		a.notFoundOr(w, err, "song")
		return
	}
	a.memoriesChanged(r.Context(), "albums")
	v, err := a.Store.PhotoAlbum(r.Context(), id, seesPlaceholders(r))
	if err != nil {
		a.serverError(w, "album", err)
		return
	}
	writeJSON(w, http.StatusCreated, v)
}

func (a *api) updatePhotoAlbum(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "album")
	if !ok {
		return
	}
	var in store.AlbumInput
	if !readJSON(w, r, &in) {
		return
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := a.Store.UpdatePhotoAlbum(r.Context(), id, in, seesPlaceholders(r)); err != nil {
		a.notFoundOr(w, err, "album")
		return
	}
	a.memoriesChanged(r.Context(), "albums")
	a.photoAlbum(w, r)
}

func (a *api) deletePhotoAlbum(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "album")
	if !ok {
		return
	}
	if err := a.Store.DeletePhotoAlbum(r.Context(), id, uid(r), isAdmin(r)); err != nil {
		a.notFoundOr(w, err, "album")
		return
	}
	a.memoriesChanged(r.Context(), "albums", "memories", "places", "chapters", "glossary")
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) reorderPhotos(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "album")
	if !ok {
		return
	}
	var in struct {
		IDs []uuid.UUID `json:"ids"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if len(in.IDs) > 2000 {
		writeError(w, http.StatusBadRequest, "too many photos")
		return
	}
	if err := a.Store.ReorderPhotos(r.Context(), id, in.IDs); err != nil {
		a.serverError(w, "reorder photos", err)
		return
	}
	a.memoriesChanged(r.Context(), "albums")
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) memories(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	list, err := a.Store.Memories(r.Context(), seesPlaceholders(r), limit)
	if err != nil {
		a.serverError(w, "memories", err)
		return
	}
	if list == nil {
		list = []store.Memory{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"memories": list})
}

type BoardMemory struct {
	ID          uuid.UUID `json:"id"`
	Title       string    `json:"title"`
	Date        string    `json:"date"`
	ThumbURL    *string   `json:"thumb_url"`
	Color       *string   `json:"color"`
	Placeholder bool      `json:"placeholder"`
}

const boardSize = 6

func (a *api) memoryBoard(w http.ResponseWriter, r *http.Request) {
	list, err := a.Store.Memories(r.Context(), seesPlaceholders(r), 0)
	if err != nil {
		a.serverError(w, "memories", err)
		return
	}
	out := []BoardMemory{}
	for _, m := range list {
		if len(out) == boardSize {
			break
		}
		b := BoardMemory{ID: m.ID, Title: m.Title, Date: m.Date, Placeholder: m.Placeholder}
		if m.Photo != nil {
			b.ThumbURL, b.Color = m.Photo.ThumbURL, m.Photo.Color
		}
		out = append(out, b)
	}
	writeJSON(w, http.StatusOK, map[string]any{"memories": out, "total": len(list)})
}

func (a *api) memory(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "memory")
	if !ok {
		return
	}
	m, err := a.Store.Memory(r.Context(), id, seesPlaceholders(r))
	if err != nil {
		a.notFoundOr(w, err, "memory")
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (a *api) createMemory(w http.ResponseWriter, r *http.Request) {
	var in store.MemoryInput
	if !readJSON(w, r, &in) {
		return
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	id, err := a.Store.CreateMemory(r.Context(), uid(r), in, false)
	if err != nil {
		a.notFoundOr(w, err, "photo or song")
		return
	}
	a.memoriesChanged(r.Context(), "memories", "soundtrack")
	m, err := a.Store.Memory(r.Context(), id, seesPlaceholders(r))
	if err != nil {
		a.serverError(w, "memory", err)
		return
	}
	writeJSON(w, http.StatusCreated, m)
}

func (a *api) updateMemory(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "memory")
	if !ok {
		return
	}
	var in store.MemoryInput
	if !readJSON(w, r, &in) {
		return
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := a.Store.UpdateMemory(r.Context(), id, in, seesPlaceholders(r)); err != nil {
		a.notFoundOr(w, err, "memory")
		return
	}
	a.memoriesChanged(r.Context(), "memories", "soundtrack")
	a.memory(w, r)
}

func (a *api) deleteMemory(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "memory")
	if !ok {
		return
	}
	if err := a.Store.DeleteMemory(r.Context(), id, uid(r), isAdmin(r)); err != nil {
		a.notFoundOr(w, err, "memory")
		return
	}
	a.memoriesChanged(r.Context(), "memories", "soundtrack")
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) places(w http.ResponseWriter, r *http.Request) {
	list, err := a.Store.Places(r.Context(), seesPlaceholders(r))
	if err != nil {
		a.serverError(w, "places", err)
		return
	}
	if list == nil {
		list = []store.Place{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"places": list})
}

func (a *api) createPlace(w http.ResponseWriter, r *http.Request) {
	var in store.PlaceInput
	if !readJSON(w, r, &in) {
		return
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := a.Store.CreatePlace(r.Context(), uid(r), in, false); err != nil {
		a.notFoundOr(w, err, "photo or song")
		return
	}
	a.memoriesChanged(r.Context(), "places", "soundtrack")
	a.places(w, r)
}

func (a *api) updatePlace(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "place")
	if !ok {
		return
	}
	var in store.PlaceInput
	if !readJSON(w, r, &in) {
		return
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := a.Store.UpdatePlace(r.Context(), id, in, seesPlaceholders(r)); err != nil {
		a.notFoundOr(w, err, "place")
		return
	}
	a.memoriesChanged(r.Context(), "places", "soundtrack")
	a.places(w, r)
}

func (a *api) deletePlace(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "place")
	if !ok {
		return
	}
	if err := a.Store.DeletePlace(r.Context(), id, uid(r), isAdmin(r)); err != nil {
		a.notFoundOr(w, err, "place")
		return
	}
	a.memoriesChanged(r.Context(), "places", "soundtrack")
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) chapters(w http.ResponseWriter, r *http.Request) {
	list, err := a.Store.Chapters(r.Context(), seesPlaceholders(r))
	if err != nil {
		a.serverError(w, "chapters", err)
		return
	}
	if list == nil {
		list = []store.Chapter{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"chapters": list})
}

func (a *api) createChapter(w http.ResponseWriter, r *http.Request) {
	var in store.ChapterInput
	if !readJSON(w, r, &in) {
		return
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := a.Store.CreateChapter(r.Context(), uid(r), in, false); err != nil {
		a.notFoundOr(w, err, "photo or song")
		return
	}
	a.memoriesChanged(r.Context(), "chapters", "soundtrack")
	a.chapters(w, r)
}

func (a *api) updateChapter(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "chapter")
	if !ok {
		return
	}
	var in store.ChapterInput
	if !readJSON(w, r, &in) {
		return
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := a.Store.UpdateChapter(r.Context(), id, in, seesPlaceholders(r)); err != nil {
		a.notFoundOr(w, err, "chapter")
		return
	}
	a.memoriesChanged(r.Context(), "chapters", "soundtrack")
	a.chapters(w, r)
}

func (a *api) deleteChapter(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "chapter")
	if !ok {
		return
	}
	if err := a.Store.DeleteChapter(r.Context(), id, uid(r), isAdmin(r)); err != nil {
		a.notFoundOr(w, err, "chapter")
		return
	}
	a.memoriesChanged(r.Context(), "chapters", "soundtrack")
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) reorderChapters(w http.ResponseWriter, r *http.Request) {
	var in struct {
		IDs []uuid.UUID `json:"ids"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if len(in.IDs) > 500 {
		writeError(w, http.StatusBadRequest, "too many chapters")
		return
	}
	if err := a.Store.ReorderChapters(r.Context(), in.IDs); err != nil {
		a.serverError(w, "reorder chapters", err)
		return
	}
	a.memoriesChanged(r.Context(), "chapters")
	a.chapters(w, r)
}

func (a *api) soundtrack(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var song OurSong
	a.setting(ctx, "our_song", &song)
	items, err := a.Store.Soundtrack(ctx, song.TrackID, a.homeTZ().String(), seesPlaceholders(r))
	if err != nil {
		a.serverError(w, "soundtrack", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (a *api) collections(w http.ResponseWriter, r *http.Request) {
	list, err := a.Store.CollectionItems(r.Context(), seesPlaceholders(r))
	if err != nil {
		a.serverError(w, "collections", err)
		return
	}
	if list == nil {
		list = []store.CollectionItem{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": list})
}

func (a *api) addToCollection(w http.ResponseWriter, r *http.Request) {
	var in struct {
		TrackID uuid.UUID `json:"track_id"`
		Reason  string    `json:"reason"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	in.Reason = strings.TrimSpace(in.Reason)
	if len([]rune(in.Reason)) > 1000 {
		writeError(w, http.StatusBadRequest, "reason of 1000 characters at most")
		return
	}
	item, added, err := a.Store.AddToCollection(r.Context(), uid(r), in.TrackID, in.Reason, false)
	if err != nil {
		a.notFoundOr(w, err, "song")
		return
	}
	if added {
		me := currentUser(r)
		title := "Reminds me of you"
		if item.Track != nil {
			title += ": " + item.Track.Title
		}
		for _, u := range a.others(r.Context(), me.ID) {
			a.notify(u.ID, "reminders", me.DisplayName, title, "/reminds/")
		}
		a.memoriesChanged(r.Context(), "collections")
	}
	status := http.StatusOK
	if added {
		status = http.StatusCreated
	}
	writeJSON(w, status, map[string]any{"item": item, "added": added})
}

func (a *api) updateCollectionItem(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "song")
	if !ok {
		return
	}
	var in struct {
		Reason string `json:"reason"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	in.Reason = strings.TrimSpace(in.Reason)
	if len([]rune(in.Reason)) > 1000 {
		writeError(w, http.StatusBadRequest, "reason of 1000 characters at most")
		return
	}
	if err := a.Store.UpdateCollectionItem(r.Context(), id, uid(r), in.Reason); err != nil {
		a.notFoundOr(w, err, "song")
		return
	}
	a.memoriesChanged(r.Context(), "collections")
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) removeFromCollection(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "song")
	if !ok {
		return
	}
	if err := a.Store.RemoveFromCollection(r.Context(), id, uid(r)); err != nil {
		a.notFoundOr(w, err, "song")
		return
	}
	a.memoriesChanged(r.Context(), "collections")
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) glossary(w http.ResponseWriter, r *http.Request) {
	list, err := a.Store.GlossaryEntries(r.Context(), seesPlaceholders(r))
	if err != nil {
		a.serverError(w, "glossary", err)
		return
	}
	if list == nil {
		list = []store.GlossaryEntry{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": list})
}

func (a *api) createGlossaryEntry(w http.ResponseWriter, r *http.Request) {
	var in store.GlossaryInput
	if !readJSON(w, r, &in) {
		return
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := a.Store.CreateGlossaryEntry(r.Context(), uid(r), in, false); err != nil {
		a.notFoundOr(w, err, "photo or song")
		return
	}
	a.memoriesChanged(r.Context(), "glossary")
	a.glossary(w, r)
}

func (a *api) updateGlossaryEntry(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "entry")
	if !ok {
		return
	}
	var in store.GlossaryInput
	if !readJSON(w, r, &in) {
		return
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := a.Store.UpdateGlossaryEntry(r.Context(), id, in, seesPlaceholders(r)); err != nil {
		a.notFoundOr(w, err, "entry")
		return
	}
	a.memoriesChanged(r.Context(), "glossary")
	a.glossary(w, r)
}

func (a *api) deleteGlossaryEntry(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "entry")
	if !ok {
		return
	}
	if err := a.Store.DeleteGlossaryEntry(r.Context(), id, uid(r), isAdmin(r)); err != nil {
		a.notFoundOr(w, err, "entry")
		return
	}
	a.memoriesChanged(r.Context(), "glossary")
	w.WriteHeader(http.StatusNoContent)
}

type MemoryHighlight struct {
	ID       uuid.UUID        `json:"id"`
	Title    string           `json:"title"`
	Caption  string           `json:"caption"`
	Date     string           `json:"date"`
	PhotoURL *string          `json:"photo_url"`
	ThumbURL *string          `json:"thumb_url"`
	Color    *string          `json:"color"`
	Track    *store.TrackView `json:"track"`
	Link     string           `json:"link"`
}

func recapDays(from, to time.Time, tz *time.Location) (string, string) {
	last := to.Add(-time.Nanosecond)
	if last.Before(from) {
		last = from
	}
	return from.In(tz).Format("2006-01-02"), last.In(tz).Format("2006-01-02")
}

func memoriesRecap(ctx context.Context, a *api, viewer *store.User, from, to time.Time) ([]RecapFigure, error) {
	withPlaceholders := viewer != nil && viewer.Role == "admin"
	c, err := a.Store.MemoryCounts(ctx, from, to, withPlaceholders)
	if err != nil {
		return nil, err
	}
	figures := []RecapFigure{
		{Key: "memories_added", Label: "Memories added", Value: c.Memories},
		{Key: "photos_added", Label: "Photos added", Value: c.Photos},
		{Key: "places_added", Label: "Places added", Value: c.Places},
		{Key: "chapters_added", Label: "Chapters added", Value: c.Chapters},
	}
	dayFrom, dayTo := recapDays(from, to, a.homeTZ())
	m, err := a.Store.HighlightedMemory(ctx, from, to, dayFrom, dayTo, withPlaceholders)
	if err != nil {
		return nil, err
	}
	if m != nil {
		h := MemoryHighlight{ID: m.ID, Title: m.Title, Caption: m.Caption, Date: m.Date, Track: m.Track, Link: "/memories/?id=" + m.ID.String()}
		if m.Photo != nil {
			h.PhotoURL, h.ThumbURL, h.Color = m.Photo.URL, m.Photo.ThumbURL, m.Photo.Color
		}
		figures = append(figures, RecapFigure{Key: "memory_highlight", Label: "Highlighted memory", Value: 1, Detail: h})
	}
	return figures, nil
}

func (a *api) adminMemories(w http.ResponseWriter, r *http.Request) {
	counts, err := a.Store.MemoryTableCounts(r.Context())
	if err != nil {
		a.serverError(w, "memories summary", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"counts": counts, "map": a.mapInfo()})
}
