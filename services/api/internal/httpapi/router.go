package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"jobbos/api/internal/devui"
	"jobbos/api/internal/importer"
	"jobbos/api/internal/media"
	"jobbos/api/internal/realtime"
	"jobbos/api/internal/store"
)

type Store interface {
	AddTrackFromSource(ctx context.Context, in store.SourceTrack) (uuid.UUID, uuid.UUID, bool, error)
	HasMainMedia(ctx context.Context, trackID uuid.UUID) (bool, error)
	Track(ctx context.Context, id uuid.UUID) (*store.TrackView, error)
	ListTracks(ctx context.Context, limit int) ([]store.TrackView, error)
	AssetBySHA(ctx context.Context, sha string) (string, string, error)
	Enqueue(ctx context.Context, j store.JobSpec) (int64, bool, error)
	EnqueueMatch(ctx context.Context, trackID uuid.UUID, priority int) error
	ImportPlaylist(ctx context.Context, in store.PlaylistImport) (store.ImportSummary, error)
	Playlists(ctx context.Context) ([]store.PlaylistSummary, error)
	Playlist(ctx context.Context, id uuid.UUID) (*store.PlaylistView, error)
	RematchPlaylist(ctx context.Context, playlistID uuid.UUID, statuses []string) (int, error)
	ChooseSource(ctx context.Context, trackID uuid.UUID, in store.SourceTrack) (uuid.UUID, bool, error)
	AddSpotifyTrack(ctx context.Context, t store.ImportTrack, priority int) (uuid.UUID, error)
	TrackSources(ctx context.Context, trackID uuid.UUID) ([]store.SourceView, error)
	ImportRecordings(ctx context.Context, in store.RecordingsImport) (store.ImportSummary, error)
	SetPlaylistSync(ctx context.Context, id uuid.UUID, enabled bool) error
	PlaylistsToSync(ctx context.Context, every time.Duration) ([]store.SyncTarget, error)
	Prefetch(ctx context.Context, ids []uuid.UUID) (int, error)
	CreateUpload(ctx context.Context, in store.UploadInput) (uuid.UUID, error)
	EnqueueCover(ctx context.Context, trackID uuid.UUID, path string) error
	UpdateTrack(ctx context.Context, id uuid.UUID, e store.TrackEdit) error
	AdminStatus(ctx context.Context) (*store.AdminStatus, error)
	RetryJob(ctx context.Context, id int64) error
	ClearUnpinned(ctx context.Context) ([]store.ClearedFile, error)
	User(ctx context.Context, id uuid.UUID) (*store.User, error)
	RegisterDevice(ctx context.Context, userID uuid.UUID, id *uuid.UUID, name, platform string) (uuid.UUID, error)
	Settings(ctx context.Context, userID uuid.UUID) (map[string]json.RawMessage, error)
	SetSetting(ctx context.Context, userID uuid.UUID, key string, value json.RawMessage) error
	Like(ctx context.Context, userID, trackID uuid.UUID) error
	Unlike(ctx context.Context, userID, trackID uuid.UUID) error
	LikedIDs(ctx context.Context, userID uuid.UUID) ([]uuid.UUID, error)
	Likes(ctx context.Context, userID uuid.UUID, sort string) ([]store.TrackView, error)
	Hide(ctx context.Context, userID uuid.UUID, itemType string, itemID uuid.UUID) error
	Unhide(ctx context.Context, userID uuid.UUID, itemType string, itemID uuid.UUID) error
	Hidden(ctx context.Context, userID uuid.UUID) ([]store.TrackView, []store.HiddenArtist, error)
	HiddenIDs(ctx context.Context, userID uuid.UUID) ([]uuid.UUID, []uuid.UUID, error)
	RecordEvents(ctx context.Context, userID uuid.UUID, events []store.ListeningEvent) error
	RecentlyPlayed(ctx context.Context, userID uuid.UUID, limit int) ([]store.TrackView, error)
	MostPlayed(ctx context.Context, userID uuid.UUID, days, limit int) ([]store.PlayedTrack, error)
	SavePlayback(ctx context.Context, userID uuid.UUID, p store.PlaybackState) error
	Playback(ctx context.Context, userID uuid.UUID) ([]store.PlaybackState, error)
	CreatePlaylist(ctx context.Context, userID uuid.UUID, name, description string) (uuid.UUID, error)
	EditPlaylist(ctx context.Context, id uuid.UUID, e store.PlaylistEdit) error
	DeletePlaylist(ctx context.Context, id uuid.UUID) error
	AddToPlaylist(ctx context.Context, playlistID, userID uuid.UUID, trackIDs []uuid.UUID) (int, error)
	RemoveFromPlaylist(ctx context.Context, playlistID, trackID uuid.UUID) error
	ReorderPlaylist(ctx context.Context, playlistID uuid.UUID, trackIDs []uuid.UUID) error
	EnqueuePlaylistCover(ctx context.Context, playlistID uuid.UUID, path string) error
	Album(ctx context.Context, id uuid.UUID) (*store.AlbumView, error)
	Artist(ctx context.Context, userID, id uuid.UUID) (*store.ArtistView, error)
	SearchLibrary(ctx context.Context, q string, limit int) ([]store.TrackView, error)
	TracksByID(ctx context.Context, ids []uuid.UUID) ([]store.TrackView, error)
	Lyrics(ctx context.Context, trackID uuid.UUID) (*store.LyricsView, error)
	SetLyricsOffset(ctx context.Context, trackID uuid.UUID, offsetMs int32) error
	BackfillLyrics(ctx context.Context) (int, error)
	BackfillEnrich(ctx context.Context) (int, error)
	RoomStats(ctx context.Context, userID uuid.UUID) (*store.RoomStats, error)
	HiddenNotes(ctx context.Context, userID uuid.UUID) ([]store.HiddenNote, error)
	FindNote(ctx context.Context, userID, noteID uuid.UUID) (*store.HiddenNote, error)
	CreateNote(ctx context.Context, authorID uuid.UUID, in store.NoteInput) (uuid.UUID, error)
	AdminNotes(ctx context.Context) ([]store.AdminNote, error)
	DeleteNote(ctx context.Context, id uuid.UUID) error
	UpdateNote(ctx context.Context, id uuid.UUID, in store.NoteInput) error
	UserCities(ctx context.Context) ([]store.UserCity, error)
	DeleteSetting(ctx context.Context, userID uuid.UUID, key string) error
	BackfillAnalysis(ctx context.Context) (int, error)
	ClaimJob(ctx context.Context, queue, worker string, kinds []string) (*store.Job, error)
	CompleteJob(ctx context.Context, id int64, result json.RawMessage) error
	FailJob(ctx context.Context, id int64, message string) error
	Login(ctx context.Context, username string) (*store.User, string, error)
	CreateSession(ctx context.Context, userID uuid.UUID, tokenHash []byte, userAgent, ip string, ttl time.Duration, max int) error
	Session(ctx context.Context, tokenHash []byte, ttl time.Duration) (*store.User, uuid.UUID, error)
	DeleteSession(ctx context.Context, tokenHash []byte) error
	DeleteUserSessions(ctx context.Context, userID, keep uuid.UUID) (int64, error)
	Accounts(ctx context.Context) ([]store.Account, error)
	Members(ctx context.Context) ([]store.User, error)
	CreateInvite(ctx context.Context, by uuid.UUID, displayName, username, message string, tokenHash []byte, ttl time.Duration) (*store.Invite, error)
	Invites(ctx context.Context) ([]store.Invite, error)
	InviteByToken(ctx context.Context, tokenHash []byte) (*store.Invite, error)
	RevokeInvite(ctx context.Context, id uuid.UUID) error
	RegenerateInvite(ctx context.Context, id uuid.UUID, tokenHash []byte, ttl time.Duration) (*store.Invite, error)
	DeclineInvite(ctx context.Context, tokenHash []byte) error
	AcceptInvite(ctx context.Context, tokenHash []byte, displayName, username, passwordHash string) (*store.User, error)
	CreatePasswordReset(ctx context.Context, userID uuid.UUID, tokenHash []byte, ttl time.Duration) error
	PasswordReset(ctx context.Context, tokenHash []byte) (*store.User, error)
	UsePasswordReset(ctx context.Context, tokenHash []byte, passwordHash string) (*store.User, error)
	Audit(ctx context.Context, actor *uuid.UUID, action, subject string, detail any)
	TouchLastSeen(ctx context.Context, userID uuid.UUID, at time.Time) error
	LastSeen(ctx context.Context) (map[uuid.UUID]*time.Time, error)
	AppSetting(ctx context.Context, key string) (json.RawMessage, error)
	SetAppSetting(ctx context.Context, key string, value json.RawMessage) error
	UserSetting(ctx context.Context, userID uuid.UUID, key string) (json.RawMessage, error)
	SendChat(ctx context.Context, sender uuid.UUID, in store.ChatInput) (*store.ChatMessage, bool, error)
	ChatMessage(ctx context.Context, id uuid.UUID) (*store.ChatMessage, error)
	ChatPage(ctx context.Context, before, after *uuid.UUID, limit int) ([]store.ChatMessage, error)
	EditChat(ctx context.Context, sender, id uuid.UUID, body string) (*store.ChatMessage, error)
	DeleteChat(ctx context.Context, sender, id uuid.UUID) (*store.ChatMessage, error)
	ReactChat(ctx context.Context, userID, id uuid.UUID, emoji string) (*store.ChatMessage, error)
	ReadChat(ctx context.Context, userID, id uuid.UUID) (time.Time, error)
	ChatReads(ctx context.Context) ([]store.ChatRead, error)
	UnreadCount(ctx context.Context, userID uuid.UUID) (int, error)
	SendLamp(ctx context.Context, from, to uuid.UUID, until time.Time) (*store.Lamp, error)
	LampOff(ctx context.Context, from, to uuid.UUID) error
	Lamps(ctx context.Context) ([]store.Lamp, error)
	LastSignal(ctx context.Context, from uuid.UUID, kind string) (*time.Time, error)
	SavePushSubscription(ctx context.Context, userID uuid.UUID, endpoint, p256dh, auth, userAgent string) error
	DeletePushSubscription(ctx context.Context, endpoint string) error
	PushSubscriptions(ctx context.Context, userID uuid.UUID) ([]store.PushSubscription, error)
	TouchPushSubscription(ctx context.Context, id uuid.UUID)
	SetSwap(ctx context.Context, week time.Time, userID, trackID uuid.UUID, note string) error
	Swaps(ctx context.Context, from, to time.Time) ([]store.Swap, error)
	SetAvatar(ctx context.Context, userID uuid.UUID, look json.RawMessage) error
	FavoriteLists(ctx context.Context) ([]store.FavoriteList, error)
	SetFavorites(ctx context.Context, userID uuid.UUID, items map[string][]string) (store.FavoriteList, error)
	Stars(ctx context.Context, revealedBefore time.Time) ([]store.Star, error)
	SongNotes(ctx context.Context, trackID *uuid.UUID) ([]store.SongNote, error)
	CreateSongNote(ctx context.Context, authorID, trackID uuid.UUID, in store.SongNoteInput) (store.SongNote, error)
	UpdateSongNote(ctx context.Context, id, authorID uuid.UUID, body string) (store.SongNote, error)
	DeleteSongNote(ctx context.Context, id, authorID uuid.UUID) error
	Clippings(ctx context.Context) ([]store.Clipping, error)
	AddClipping(ctx context.Context, userID, trackID uuid.UUID, lines []store.CardLine) (store.Clipping, error)
	DeleteClipping(ctx context.Context, id, userID uuid.UUID) error
	CreateVoiceClip(ctx context.Context, authorID uuid.UUID, path string) (store.VoiceClip, error)
	VoiceClip(ctx context.Context, id uuid.UUID) (store.VoiceClip, error)
	CreateDedication(ctx context.Context, authorID, trackID, clipID uuid.UUID, note string) (store.Dedication, error)
	Dedications(ctx context.Context, trackID *uuid.UUID) ([]store.Dedication, error)
	DedicatedTrackIDs(ctx context.Context) ([]uuid.UUID, error)
	DeleteDedication(ctx context.Context, id, authorID uuid.UUID) error
	Mixtapes(ctx context.Context, userID uuid.UUID) ([]store.MixtapeSummary, error)
	Mixtape(ctx context.Context, id, userID uuid.UUID) (store.Mixtape, error)
	SaveMixtape(ctx context.Context, id *uuid.UUID, fromUser, toUser uuid.UUID, in store.MixtapeInput) (uuid.UUID, error)
	SendMixtape(ctx context.Context, id, fromUser uuid.UUID) (store.MixtapeSummary, error)
	OpenMixtape(ctx context.Context, id, toUser uuid.UUID) error
	DeleteMixtape(ctx context.Context, id, fromUser uuid.UUID) error
	RecentSearches(ctx context.Context, userID uuid.UUID) ([]string, error)
	AddRecentSearch(ctx context.Context, userID uuid.UUID, q string) error
	DeleteRecentSearch(ctx context.Context, userID uuid.UUID, q string) error
	ReviewList(ctx context.Context, list string, playlistID *uuid.UUID, limit int) ([]store.ReviewItem, error)
	ReviewCounts(ctx context.Context, playlistID *uuid.UUID) (store.ReviewCounts, error)
	SetMatchCheck(ctx context.Context, trackID, userID uuid.UUID, verdict string) error
	SetLyrics(ctx context.Context, trackID uuid.UUID, synced, plain string, instrumental bool) error
	SyncedLRC(ctx context.Context, trackID uuid.UUID) (string, error)
	ListeningNow(ctx context.Context) (map[uuid.UUID]store.NowPlaying, error)
}

type Searcher interface {
	Search(ctx context.Context, query string, limit int, sources []string) (json.RawMessage, error)
}

type Deps struct {
	Store       Store
	Media       Searcher
	Resolver    Resolver
	Links       Linker
	MediaStatus StatusReader
	World       WeatherSource
	Locator     CityLocator
	AutoUser    *store.User
	Hub         *realtime.Hub
	Push        *PushKeys
	HomeTZ      *time.Location
	WebRoot     string
	MediaRoot   string
	WorkerToken string
	DevUI       bool
	Log         *slog.Logger
}

type api struct {
	Deps
	upstream *http.Client
	mu       sync.Mutex
	streams  map[uuid.UUID]cachedStream
	workers  map[string]workerSeen
	limits   limits
	team     memberCache
	room     together
	playing  sync.Map
}

var mediaFileRE = regexp.MustCompile(`^([0-9a-f]{64})(\.300)?\.(m4a|jpg|png|webp)$`)

func New(d Deps) http.Handler {
	a := &api{Deps: d, upstream: newUpstreamClient(), streams: map[uuid.UUID]cachedStream{}, workers: map[string]workerSeen{}, limits: newLimits()}
	a.registerRealtime()
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.Recoverer)
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, http.StatusOK, map[string]bool{"ok": true}) })
	if d.DevUI {
		r.Get("/dev", func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, "/dev/", http.StatusMovedPermanently)
		})
		r.Get("/dev/", devui.Handler)
	}

	r.Route("/api", func(r chi.Router) {
		r.Post("/auth/login", a.login)
		r.Post("/auth/logout", a.logout)
		r.Get("/invites/{token}", a.invitePage)
		r.Post("/invites/{token}/accept", a.acceptInvite)
		r.Post("/invites/{token}/decline", a.declineInvite)
		r.Get("/resets/{token}", a.resetPage)
		r.Post("/resets/{token}", a.usePasswordReset)
		r.Group(func(r chi.Router) {
			r.Use(a.authenticate)
			r.Get("/search", a.search)
			r.Get("/tracks", a.listTracks)
			r.Post("/tracks", a.addTrack)
			r.Get("/tracks/{id}", a.track)
			r.Get("/tracks/{id}/audio", a.trackAudio)
			r.Get("/tracks/{id}/stream", a.streamTrack)
			r.Post("/tracks/{id}/cache", a.cacheTrack)
			r.Put("/tracks/{id}/source", a.chooseSource)
			r.Get("/tracks/{id}/sources", a.trackSources)
			r.Post("/links", a.importLink)
			r.Patch("/tracks/{id}", a.updateTrack)
			r.Post("/tracks/{id}/cover", a.setCover)
			r.Post("/uploads", a.upload)
			r.Post("/prefetch", a.prefetch)
			r.Patch("/playlists/{id}", a.updatePlaylist)
			r.Post("/playlists", a.createPlaylist)
			r.Delete("/playlists/{id}", a.deletePlaylist)
			r.Post("/playlists/{id}/items", a.addToPlaylist)
			r.Put("/playlists/{id}/items", a.reorderPlaylist)
			r.Delete("/playlists/{id}/items/{trackID}", a.removeFromPlaylist)
			r.Post("/playlists/{id}/cover", a.setPlaylistCover)
			r.Get("/albums/{id}", a.album)
			r.Get("/artists/{id}", a.artist)
			r.Get("/library/search", a.searchLibrary)
			r.Post("/tracks/batch", a.tracksByID)
			r.Get("/me", a.me)
			r.Get("/members", a.members)
			r.Get("/ws", a.websocket)
			r.Get("/presence", a.presence)
			r.Put("/quiet", a.setQuiet)
			r.Get("/chat/messages", a.chatMessages)
			r.Post("/chat/messages", a.sendChat)
			r.Patch("/chat/messages/{id}", a.editChat)
			r.Delete("/chat/messages/{id}", a.deleteChat)
			r.Put("/chat/messages/{id}/reaction", a.reactChat)
			r.Delete("/chat/messages/{id}/reaction", a.reactChat)
			r.Post("/chat/read", a.readChat)
			r.Post("/signals/lamp", a.sendLamp)
			r.Get("/push/key", a.pushKey)
			r.Post("/push/subscribe", a.subscribePush)
			r.Delete("/push/subscribe", a.unsubscribePush)
			r.Get("/swaps", a.swaps)
			r.Put("/swaps/current", a.setSwap)
			r.Get("/together", a.togetherState)
			r.Post("/devices", a.registerDevice)
			r.Get("/settings", a.settings)
			r.Put("/settings/{key}", a.setSetting)
			r.Get("/likes", a.likes)
			r.Get("/likes/ids", a.likedIDs)
			r.Put("/likes/{trackID}", a.setLike)
			r.Delete("/likes/{trackID}", a.setLike)
			r.Get("/hidden", a.hidden)
			r.Get("/hidden/ids", a.hiddenIDs)
			r.Put("/hidden/{type}/{id}", a.setHidden)
			r.Delete("/hidden/{type}/{id}", a.setHidden)
			r.Post("/events", a.events)
			r.Get("/history/recent", a.recentlyPlayed)
			r.Get("/history/top", a.mostPlayed)
			r.Get("/playback", a.playback)
			r.Put("/playback", a.savePlayback)
			r.Route("/admin", func(r chi.Router) {
				r.Use(a.requireAdmin)
				r.Get("/accounts", a.adminAccounts)
				r.Post("/accounts/{id}/reset", a.adminResetLink)
				r.Post("/accounts/{id}/signout", a.adminSignOut)
				r.Get("/invites", a.adminInvites)
				r.Get("/visibility", a.adminVisibility)
				r.Put("/visibility", a.setVisibility)
				r.Post("/invites", a.createInvite)
				r.Post("/invites/{id}/revoke", a.revokeInvite)
				r.Post("/invites/{id}/regenerate", a.regenerateInvite)
				r.Get("/status", a.adminStatus)
				r.Post("/jobs/{id}/retry", a.retryJob)
				r.Post("/cache/clear", a.clearCache)
				r.Post("/playlists/sync", a.syncNow)
				a.registerWorldAdminRoutes(r)
				a.registerGiftAdminRoutes(r)
				a.registerReviewRoutes(r)
			})
			a.registerWorldRoutes(r)
			a.registerGiftRoutes(r)
			r.Get("/tracks/{id}/lyrics", a.lyrics)
			r.Patch("/tracks/{id}/lyrics", a.lyricsOffset)
			r.Post("/lyrics/backfill", a.backfillLyrics)
			r.Post("/artwork/backfill", a.backfillEnrich)
			r.Get("/media/{file}", a.mediaFile)
			r.Get("/playlists", a.listPlaylists)
			r.Post("/playlists/import", a.importPlaylist)
			r.Get("/playlists/{id}", a.playlist)
			r.Post("/playlists/{id}/rematch", a.rematchPlaylist)
		})
	})
	if d.WebRoot != "" {
		r.Handle("/*", webApp(d.WebRoot))
	}
	r.Route("/internal", func(r chi.Router) {
		r.Use(a.requireWorker)
		r.Post("/jobs/claim", a.claimJob)
		r.Post("/jobs/{id}/complete", a.completeJob)
		r.Post("/jobs/{id}/fail", a.failJob)
	})
	return r
}

var searchSources = map[string]bool{"ytmusic": true, "youtube": true, "soundcloud": true}

func (a *api) search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" || len(q) > 200 {
		writeError(w, http.StatusBadRequest, "q is required (200 characters at most)")
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	var sources []string
	if s := r.URL.Query().Get("sources"); s != "" {
		for _, name := range strings.Split(s, ",") {
			if !searchSources[name] {
				writeError(w, http.StatusBadRequest, "sources must be a list of ytmusic, youtube and soundcloud")
				return
			}
			sources = append(sources, name)
		}
	}
	body, err := a.Media.Search(r.Context(), q, limit, sources)
	if err != nil {
		a.Log.Error("search", "err", err)
		writeError(w, http.StatusBadGateway, "search is unavailable")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(body)
}

func (a *api) addTrack(w http.ResponseWriter, r *http.Request) {
	var in store.SourceTrack
	if !readJSON(w, r, &in) {
		return
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	trackID, sourceID, created, err := a.Store.AddTrackFromSource(r.Context(), in)
	if err != nil {
		a.serverError(w, "add track", err)
		return
	}
	cached, err := a.Store.HasMainMedia(r.Context(), trackID)
	if err != nil {
		a.serverError(w, "check media", err)
		return
	}
	if !cached {
		if err := a.enqueueDownload(r.Context(), trackID, sourceID, in.Provider, in.ExternalID); err != nil {
			a.serverError(w, "enqueue download", err)
			return
		}
	}
	view, err := a.Store.Track(r.Context(), trackID)
	if err != nil {
		a.serverError(w, "load track", err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, view)
}

func (a *api) enqueueDownload(ctx context.Context, trackID, sourceID uuid.UUID, provider, externalID string) error {
	_, _, err := a.Store.Enqueue(ctx, store.JobSpec{
		Kind:      store.KindDownloadTrack,
		Payload:   store.DownloadPayload{TrackID: trackID, SourceID: sourceID, Provider: provider, ExternalID: externalID},
		DedupeKey: store.DownloadKey(sourceID),
		Priority:  store.PriorityInteractive,
	})
	return err
}

func (a *api) cacheTrack(w http.ResponseWriter, r *http.Request) {
	view, ok := a.loadTrack(w, r)
	if !ok {
		return
	}
	if view.Status == "cached" {
		writeJSON(w, http.StatusOK, view)
		return
	}
	var err error
	switch {
	case view.Source != nil:
		err = a.enqueueDownload(r.Context(), view.ID, view.Source.ID, view.Source.Provider, view.Source.ExternalID)
	case view.MatchStatus != nil && *view.MatchStatus == "pending":
		err = a.Store.EnqueueMatch(r.Context(), view.ID, store.PriorityInteractive)
	default:
		writeError(w, http.StatusConflict, "track has no recording")
		return
	}
	if err != nil {
		a.serverError(w, "enqueue", err)
		return
	}
	if view, err = a.Store.Track(r.Context(), view.ID); err != nil {
		a.serverError(w, "load track", err)
		return
	}
	writeJSON(w, http.StatusAccepted, view)
}

func (a *api) chooseSource(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "track not found")
		return
	}
	var body struct {
		store.SourceTrack
		URL string `json:"url"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	in := body.SourceTrack
	if body.URL != "" {
		if !isLink(body.URL) {
			writeError(w, http.StatusBadRequest, "url must be a link")
			return
		}
		l, ok := a.link(w, r, body.URL)
		if !ok {
			return
		}
		if l.Kind != "recording" {
			writeError(w, http.StatusUnprocessableEntity, "A version must be a link to one recording")
			return
		}
		in = store.SourceTrack{}
		if err := json.Unmarshal(l.Recording, &in); err != nil {
			a.serverError(w, "decode recording", err)
			return
		}
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	sourceID, download, err := a.Store.ChooseSource(r.Context(), id, in)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "track not found")
		return
	}
	if err != nil {
		a.serverError(w, "choose source", err)
		return
	}
	if download {
		if err := a.enqueueDownload(r.Context(), id, sourceID, in.Provider, in.ExternalID); err != nil {
			a.serverError(w, "enqueue download", err)
			return
		}
	}
	view, err := a.Store.Track(r.Context(), id)
	if err != nil {
		a.serverError(w, "load track", err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (a *api) lyrics(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "track not found")
		return
	}
	view, err := a.Store.Lyrics(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "lyrics not looked up yet")
		return
	}
	if err != nil {
		a.serverError(w, "load lyrics", err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (a *api) lyricsOffset(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "track not found")
		return
	}
	var in struct {
		OffsetMs *int32 `json:"offset_ms"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.OffsetMs == nil || *in.OffsetMs > store.MaxLyricsOffsetMs || *in.OffsetMs < -store.MaxLyricsOffsetMs {
		writeError(w, http.StatusBadRequest, "offset_ms is required (ten minutes at most either way)")
		return
	}
	err = a.Store.SetLyricsOffset(r.Context(), id, *in.OffsetMs)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "lyrics not looked up yet")
		return
	}
	if err != nil {
		a.serverError(w, "set lyrics offset", err)
		return
	}
	a.lyrics(w, r)
}

func (a *api) backfillLyrics(w http.ResponseWriter, r *http.Request) {
	n, err := a.Store.BackfillLyrics(r.Context())
	if err != nil {
		a.serverError(w, "backfill lyrics", err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]int{"queued": n})
}

func (a *api) backfillEnrich(w http.ResponseWriter, r *http.Request) {
	n, err := a.Store.BackfillEnrich(r.Context())
	if err != nil {
		a.serverError(w, "backfill artwork", err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]int{"queued": n})
}

func (a *api) trackSources(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "track not found")
		return
	}
	sources, err := a.Store.TrackSources(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "track not found")
		return
	}
	if err != nil {
		a.serverError(w, "list sources", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sources": sources})
}

func isLink(s string) bool {
	u, err := url.Parse(strings.TrimSpace(s))
	return err == nil && len(s) <= 2048 && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

func (a *api) link(w http.ResponseWriter, r *http.Request, raw string) (*media.Link, bool) {
	l, err := a.Links.Link(r.Context(), strings.TrimSpace(raw))
	var linkErr *media.LinkError
	switch {
	case errors.As(err, &linkErr):
		writeError(w, http.StatusUnprocessableEntity, linkErr.Message)
		return nil, false
	case err != nil:
		a.Log.Warn("link", "url", raw, "err", err)
		writeError(w, http.StatusBadGateway, "link lookup failed")
		return nil, false
	}
	return l, true
}

func (a *api) importLink(w http.ResponseWriter, r *http.Request) {
	var in struct {
		URL string `json:"url"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if !isLink(in.URL) {
		writeError(w, http.StatusBadRequest, "url must be a link")
		return
	}
	l, ok := a.link(w, r, in.URL)
	if !ok {
		return
	}
	switch {
	case l.Kind == "recording":
		var rec store.SourceTrack
		if err := json.Unmarshal(l.Recording, &rec); err != nil || rec.Validate() != nil {
			writeError(w, http.StatusBadGateway, "link lookup returned no recording")
			return
		}
		trackID, sourceID, _, err := a.Store.AddTrackFromSource(r.Context(), rec)
		if err != nil {
			a.serverError(w, "add track", err)
			return
		}
		if cached, err := a.Store.HasMainMedia(r.Context(), trackID); err == nil && !cached {
			if err := a.enqueueDownload(r.Context(), trackID, sourceID, rec.Provider, rec.ExternalID); err != nil {
				a.serverError(w, "enqueue download", err)
				return
			}
		}
		a.writeTrack(w, r, trackID)
	case l.Kind == "playlist":
		var recs []store.SourceTrack
		if err := json.Unmarshal(l.Recordings, &recs); err != nil {
			writeError(w, http.StatusBadGateway, "link lookup returned no playlist")
			return
		}
		sum, err := a.Store.ImportRecordings(r.Context(), recordingsImport(l, in.URL, recs))
		if err != nil {
			a.serverError(w, "import playlist", err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"playlist": sum, "truncated": l.Truncated})
	case l.Kind == "spotify" && l.Type == "track" && len(l.Tracks) == 1:
		trackID, err := a.Store.AddSpotifyTrack(r.Context(), importTrack(l.Tracks[0]), store.PriorityInteractive)
		if err != nil {
			a.serverError(w, "add track", err)
			return
		}
		a.writeTrack(w, r, trackID)
	case l.Kind == "spotify" && (l.Type == "album" || l.Type == "playlist"):
		tracks := make([]store.ImportTrack, len(l.Tracks))
		for i, t := range l.Tracks {
			tracks[i] = importTrack(t)
		}
		sum, err := a.Store.ImportPlaylist(r.Context(), store.PlaylistImport{
			Provider: "spotify", ExternalID: l.ID, URL: "https://open.spotify.com/" + l.Type + "/" + l.ID,
			Name: l.Name, Tracks: tracks,
		})
		if err != nil {
			a.serverError(w, "import playlist", err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"playlist": sum, "truncated": l.Truncated})
	default:
		writeError(w, http.StatusBadGateway, "link lookup returned nothing to play")
	}
}

func (a *api) writeTrack(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
	view, err := a.Store.Track(r.Context(), id)
	if err != nil {
		a.serverError(w, "load track", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"track": view})
}

func importTrack(t media.SpotifyTrack) store.ImportTrack {
	it := store.ImportTrack{SpotifyID: t.SpotifyID, Title: t.Title, Album: t.Album, AlbumSpotifyID: t.AlbumSpotifyID, Explicit: t.Explicit}
	for _, a := range t.Artists {
		artist := store.ImportArtist{Name: a.Name}
		if a.SpotifyID != nil {
			artist.SpotifyID = *a.SpotifyID
		}
		it.Artists = append(it.Artists, artist)
	}
	if t.ArtworkURL != nil {
		it.ArtworkURL = *t.ArtworkURL
	}
	if t.DurationMs != nil {
		it.DurationMs = *t.DurationMs
	}
	return it
}

func (a *api) importPlaylist(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	playlistID, err := importer.SpotifyPlaylistID(q.Get("url"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "url must be a Spotify playlist link")
		return
	}
	name := strings.TrimSpace(q.Get("name"))
	if name == "" || len(name) > 200 {
		writeError(w, http.StatusBadRequest, "name is required (200 characters at most)")
		return
	}
	tracks, skipped, err := importer.ParseExportify(http.MaxBytesReader(w, r.Body, 20<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(tracks) == 0 {
		writeError(w, http.StatusBadRequest, "the export has no tracks")
		return
	}
	sum, err := a.Store.ImportPlaylist(r.Context(), store.PlaylistImport{
		Provider:   "spotify",
		ExternalID: playlistID,
		URL:        "https://open.spotify.com/playlist/" + playlistID,
		Name:       name,
		Tracks:     tracks,
	})
	if err != nil {
		a.serverError(w, "import playlist", err)
		return
	}
	sum.Skipped = skipped
	a.Log.Info("playlist imported", "playlist", sum.PlaylistID, "tracks", sum.Tracks, "added", sum.Added, "queued", sum.Queued)
	status := http.StatusOK
	if sum.Created {
		status = http.StatusCreated
	}
	writeJSON(w, status, sum)
}

func (a *api) listPlaylists(w http.ResponseWriter, r *http.Request) {
	playlists, err := a.Store.Playlists(r.Context())
	if err != nil {
		a.serverError(w, "list playlists", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"playlists": playlists})
}

func (a *api) playlist(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "playlist not found")
		return
	}
	view, err := a.Store.Playlist(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "playlist not found")
		return
	}
	if err != nil {
		a.serverError(w, "load playlist", err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (a *api) rematchPlaylist(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "playlist not found")
		return
	}
	statuses := strings.Split(r.URL.Query().Get("status"), ",")
	if r.URL.Query().Get("status") == "" {
		statuses = []string{"review", "unmatched"}
	}
	for _, s := range statuses {
		if !store.RematchStatuses[s] {
			writeError(w, http.StatusBadRequest, "status must be a list of pending, matched, review and unmatched")
			return
		}
	}
	n, err := a.Store.RematchPlaylist(r.Context(), id, statuses)
	if err != nil {
		a.serverError(w, "rematch playlist", err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]int{"queued": n})
}

func (a *api) listTracks(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	tracks, err := a.Store.ListTracks(r.Context(), limit)
	if err != nil {
		a.serverError(w, "list tracks", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tracks": tracks})
}

func (a *api) track(w http.ResponseWriter, r *http.Request) {
	view, ok := a.loadTrack(w, r)
	if ok {
		writeJSON(w, http.StatusOK, view)
	}
}

func (a *api) trackAudio(w http.ResponseWriter, r *http.Request) {
	view, ok := a.loadTrack(w, r)
	if !ok {
		return
	}
	if view.Audio == nil {
		writeJSON(w, http.StatusAccepted, map[string]any{"status": view.Status, "error": view.Error})
		return
	}
	http.Redirect(w, r, view.Audio.URL, http.StatusTemporaryRedirect)
}

func (a *api) loadTrack(w http.ResponseWriter, r *http.Request) (*store.TrackView, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "track not found")
		return nil, false
	}
	view, err := a.Store.Track(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "track not found")
		return nil, false
	}
	if err != nil {
		a.serverError(w, "load track", err)
		return nil, false
	}
	return view, true
}

func (a *api) mediaFile(w http.ResponseWriter, r *http.Request) {
	m := mediaFileRE.FindStringSubmatch(chi.URLParam(r, "file"))
	if m == nil {
		http.NotFound(w, r)
		return
	}
	sha, thumb, ext := m[1], m[2] != "", m[3]
	if thumb && ext != "jpg" {
		http.NotFound(w, r)
		return
	}
	rel, mime, err := a.Store.AssetBySHA(r.Context(), sha)
	if errors.Is(err, store.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		a.serverError(w, "load asset", err)
		return
	}
	etag := sha
	switch {
	case thumb && strings.HasPrefix(mime, "image/"):
		rel, mime, etag = strings.TrimSuffix(rel, path.Ext(rel))+".300.jpg", "image/jpeg", sha+".300"
	case thumb || store.MediaExt[mime] != ext:
		http.NotFound(w, r)
		return
	}
	root, _ := filepath.Abs(a.MediaRoot)
	full := filepath.Join(root, filepath.FromSlash(rel))
	if !strings.HasPrefix(full, root+string(filepath.Separator)) {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(full)
	if err != nil {
		a.serverError(w, "open asset", err)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		a.serverError(w, "stat asset", err)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("ETag", `"`+etag+`"`)
	http.ServeContent(w, r, etag+"."+ext, info.ModTime(), f)
}

func (a *api) requireWorker(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || a.WorkerToken == "" || subtle.ConstantTimeCompare([]byte(token), []byte(a.WorkerToken)) != 1 {
			writeError(w, http.StatusUnauthorized, "worker token required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *api) claimJob(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Queue            string   `json:"queue"`
		Worker           string   `json:"worker"`
		Kinds            []string `json:"kinds"`
		DownloadsPausedS int      `json:"downloads_paused_s"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	a.seeWorker(in.Worker, in.DownloadsPausedS)
	if in.Queue == "" {
		in.Queue = "default"
	}
	job, err := a.Store.ClaimJob(r.Context(), in.Queue, in.Worker, in.Kinds)
	if err != nil {
		a.serverError(w, "claim job", err)
		return
	}
	if job == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(w, http.StatusOK, job)
}

func (a *api) completeJob(w http.ResponseWriter, r *http.Request) {
	id, ok := jobID(w, r)
	if !ok {
		return
	}
	var in struct {
		Result json.RawMessage `json:"result"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	a.finishJob(w, "complete job", a.Store.CompleteJob(r.Context(), id, in.Result))
}

func (a *api) failJob(w http.ResponseWriter, r *http.Request) {
	id, ok := jobID(w, r)
	if !ok {
		return
	}
	var in struct {
		Error string `json:"error"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	a.finishJob(w, "fail job", a.Store.FailJob(r.Context(), id, in.Error))
}

func (a *api) finishJob(w http.ResponseWriter, what string, err error) {
	switch {
	case errors.Is(err, store.ErrJobNotRunning):
		writeError(w, http.StatusConflict, err.Error())
	case err != nil:
		a.serverError(w, what, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func jobID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, "job not found")
		return 0, false
	}
	return id, true
}

func (a *api) serverError(w http.ResponseWriter, what string, err error) {
	a.Log.Error(what, "err", err)
	writeError(w, http.StatusInternalServerError, "internal error")
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
