package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

const settingHerPlaylist = "gift.her_playlist"

func (a *api) herPlaylistID(ctx context.Context) (uuid.UUID, bool) {
	var id uuid.UUID
	if !a.setting(ctx, settingHerPlaylist, &id) || id == uuid.Nil {
		return uuid.Nil, false
	}
	return id, true
}

func (a *api) applyHerPlaylist(ctx context.Context) error {
	id, ok := a.herPlaylistID(ctx)
	if !ok {
		return nil
	}
	for _, m := range a.memberList(ctx) {
		if m.Role == "member" {
			return a.Store.SetPlaylistRecipient(ctx, id, &m.ID)
		}
	}
	return nil
}

func (a *api) herPlaylist(w http.ResponseWriter, r *http.Request) {
	id, ok := a.herPlaylistID(r.Context())
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"playlist_id": nil})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"playlist_id": id})
}

func (a *api) setHerPlaylist(w http.ResponseWriter, r *http.Request) {
	var in struct {
		PlaylistID uuid.UUID `json:"playlist_id"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	ctx := r.Context()
	if _, err := a.Store.Playlist(ctx, in.PlaylistID); err != nil {
		writeError(w, http.StatusNotFound, "playlist not found")
		return
	}
	if old, ok := a.herPlaylistID(ctx); ok && old != in.PlaylistID {
		if err := a.Store.SetPlaylistRecipient(ctx, old, nil); err != nil {
			a.serverError(w, "clear playlist recipient", err)
			return
		}
	}
	raw, _ := json.Marshal(in.PlaylistID)
	if err := a.Store.SetAppSetting(ctx, settingHerPlaylist, raw); err != nil {
		a.serverError(w, "save her playlist", err)
		return
	}
	if err := a.applyHerPlaylist(ctx); err != nil {
		a.serverError(w, "apply her playlist", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"playlist_id": in.PlaylistID})
}

func (a *api) useSpotifyCover(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "playlist")
	if !ok {
		return
	}
	p, err := a.Store.Playlist(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "playlist not found")
		return
	}
	if p.Provider == nil || *p.Provider != "spotify" || p.SourceURL == nil {
		writeError(w, http.StatusBadRequest, "not a Spotify playlist")
		return
	}
	if err := a.fetchSpotifyCover(r.Context(), id, *p.SourceURL); err != nil {
		writeError(w, http.StatusBadGateway, "Spotify cover unavailable")
		a.Log.Warn("spotify cover", "playlist", id, "err", err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func spotifyImage(u string) bool {
	p, err := url.Parse(u)
	return err == nil && p.Scheme == "https" && (strings.HasSuffix(p.Host, ".scdn.co") || strings.HasSuffix(p.Host, ".spotifycdn.com"))
}

func (a *api) fetchSpotifyCover(ctx context.Context, playlistID uuid.UUID, playlistURL string) error {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	var meta struct {
		ThumbnailURL string `json:"thumbnail_url"`
	}
	if err := a.getJSON(ctx, "https://open.spotify.com/oembed?url="+url.QueryEscape(playlistURL), &meta); err != nil {
		return err
	}
	if !spotifyImage(meta.ThumbnailURL) {
		return fmt.Errorf("unexpected thumbnail %q", meta.ThumbnailURL)
	}
	var body []byte
	var err error
	for _, u := range []string{strings.Replace(meta.ThumbnailURL, "0000da84", "0000bebb", 1), meta.ThumbnailURL} {
		if body, err = a.getImage(ctx, u); err == nil {
			break
		}
	}
	if err != nil {
		return err
	}
	dir := filepath.Join(a.MediaRoot, "uploads")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	name := uuid.NewString() + ".jpg"
	if err := os.WriteFile(filepath.Join(dir, name), body, 0o644); err != nil {
		return err
	}
	return a.Store.EnqueuePlaylistCover(ctx, playlistID, "uploads/"+name)
}

func (a *api) getJSON(ctx context.Context, u string, into any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	res, err := a.upstream.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: %s", u, res.Status)
	}
	return json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(into)
}

func (a *api) getImage(ctx context.Context, u string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	res, err := a.upstream.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK || !strings.HasPrefix(res.Header.Get("Content-Type"), "image/") {
		return nil, fmt.Errorf("%s: %s %s", u, res.Status, res.Header.Get("Content-Type"))
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, 8<<20+1))
	if err != nil {
		return nil, err
	}
	if len(body) > 8<<20 {
		return nil, errors.New("image too large")
	}
	return body, nil
}
