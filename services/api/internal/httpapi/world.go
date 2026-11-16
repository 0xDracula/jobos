package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"jobbos/api/internal/store"
	"jobbos/api/internal/world"
)

type WeatherSource interface {
	Weather(ctx context.Context, lat, lon float64) (*world.Weather, error)
	Search(ctx context.Context, name string) ([]world.Place, error)
}

type CityLocator interface {
	City(ip netip.Addr) (world.Place, bool)
}

const (
	settingManualCity   = "location.manual"
	settingDetectedCity = "location.detected"
)

type cityView struct {
	world.Place
	Source    string    `json:"source"`
	UpdatedAt time.Time `json:"updated_at"`
}

func clientIP(r *http.Request) netip.Addr {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}
	}
	if addr.IsLoopback() {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			if first, err := netip.ParseAddr(strings.TrimSpace(strings.Split(xff, ",")[0])); err == nil {
				return first
			}
		}
	}
	return addr
}

func decodeCity(raw json.RawMessage) *cityView {
	if len(raw) == 0 {
		return nil
	}
	var c cityView
	if json.Unmarshal(raw, &c) != nil || c.Name == "" {
		return nil
	}
	return &c
}

func (a *api) location(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	settings, err := a.Store.Settings(ctx, a.CurrentUser)
	if err != nil {
		a.serverError(w, "load settings", err)
		return
	}
	detection := a.Locator != nil
	if manual := decodeCity(settings[settingManualCity]); manual != nil {
		writeJSON(w, http.StatusOK, map[string]any{"city": manual, "detection": detection})
		return
	}
	last := decodeCity(settings[settingDetectedCity])
	if a.Locator != nil {
		if place, ok := a.Locator.City(clientIP(r)); ok {
			if last == nil || last.Place != place {
				last = &cityView{Place: place, Source: "detected", UpdatedAt: time.Now().UTC()}
				if body, err := json.Marshal(last); err == nil {
					if err := a.Store.SetSetting(ctx, a.CurrentUser, settingDetectedCity, body); err != nil {
						a.Log.Warn("save detected city", "err", err)
					}
				}
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"city": last, "detection": detection})
}

func (a *api) setLocation(w http.ResponseWriter, r *http.Request) {
	var in world.Place
	if !readJSON(w, r, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	c := cityView{Place: in, Source: "manual", UpdatedAt: time.Now().UTC()}
	body, _ := json.Marshal(c)
	if err := a.Store.SetSetting(r.Context(), a.CurrentUser, settingManualCity, body); err != nil {
		a.serverError(w, "save city", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"city": c, "detection": a.Locator != nil})
}

func (a *api) clearLocation(w http.ResponseWriter, r *http.Request) {
	a.noContent(w, "clear city", a.Store.DeleteSetting(r.Context(), a.CurrentUser, settingManualCity))
}

func (a *api) locations(w http.ResponseWriter, r *http.Request) {
	users, err := a.Store.UserCities(r.Context())
	if err != nil {
		a.serverError(w, "load cities", err)
		return
	}
	type entry struct {
		UserID      string    `json:"user_id"`
		DisplayName string    `json:"display_name"`
		Me          bool      `json:"me"`
		City        *cityView `json:"city"`
	}
	out := make([]entry, 0, len(users))
	for _, u := range users {
		out = append(out, entry{UserID: u.UserID.String(), DisplayName: u.DisplayName, Me: u.UserID == a.CurrentUser, City: decodeCity(u.City)})
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out})
}

func (a *api) searchCities(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(q) < 2 || len(q) > 100 {
		writeError(w, http.StatusBadRequest, "q must be 2 to 100 characters")
		return
	}
	if a.World == nil {
		writeError(w, http.StatusServiceUnavailable, "city search unavailable")
		return
	}
	places, err := a.World.Search(r.Context(), q)
	if err != nil {
		a.Log.Warn("city search", "err", err)
		writeError(w, http.StatusBadGateway, "city search unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"places": places})
}

func coordParam(r *http.Request, name string, limit float64) (float64, bool) {
	v, err := strconv.ParseFloat(r.URL.Query().Get(name), 64)
	return v, err == nil && v >= -limit && v <= limit
}

func (a *api) weather(w http.ResponseWriter, r *http.Request) {
	lat, okLat := coordParam(r, "lat", 90)
	lon, okLon := coordParam(r, "lon", 180)
	if !okLat || !okLon {
		writeError(w, http.StatusBadRequest, "lat and lon are required")
		return
	}
	if a.World == nil {
		writeError(w, http.StatusServiceUnavailable, "weather unavailable")
		return
	}
	wx, err := a.World.Weather(r.Context(), lat, lon)
	if err != nil {
		a.Log.Warn("weather", "err", err)
		writeError(w, http.StatusBadGateway, "weather unavailable")
		return
	}
	writeJSON(w, http.StatusOK, wx)
}

func (a *api) roomStats(w http.ResponseWriter, r *http.Request) {
	st, err := a.Store.RoomStats(r.Context(), a.CurrentUser)
	if err != nil {
		a.serverError(w, "room stats", err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (a *api) hiddenNotes(w http.ResponseWriter, r *http.Request) {
	notes, err := a.Store.HiddenNotes(r.Context(), a.CurrentUser)
	if err != nil {
		a.serverError(w, "hidden notes", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"notes": notes})
}

func (a *api) findNote(w http.ResponseWriter, r *http.Request) {
	id, ok := trackParam(w, r, "id")
	if !ok {
		return
	}
	n, err := a.Store.FindNote(r.Context(), a.CurrentUser, id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "note not found")
		return
	}
	if err != nil {
		a.serverError(w, "find note", err)
		return
	}
	writeJSON(w, http.StatusOK, n)
}

func (a *api) adminNotes(w http.ResponseWriter, r *http.Request) {
	notes, err := a.Store.AdminNotes(r.Context())
	if err != nil {
		a.serverError(w, "list notes", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"notes": notes})
}

func (a *api) createNote(w http.ResponseWriter, r *http.Request) {
	var in store.NoteInput
	if !readJSON(w, r, &in) {
		return
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	id, err := a.Store.CreateNote(r.Context(), a.CurrentUser, in)
	if err != nil {
		a.serverError(w, "create note", err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id})
}

func (a *api) deleteNote(w http.ResponseWriter, r *http.Request) {
	id, ok := trackParam(w, r, "id")
	if !ok {
		return
	}
	err := a.Store.DeleteNote(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "note not found")
		return
	}
	a.noContent(w, "delete note", err)
}

func (a *api) backfillAnalysis(w http.ResponseWriter, r *http.Request) {
	n, err := a.Store.BackfillAnalysis(r.Context())
	if err != nil {
		a.serverError(w, "backfill analysis", err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]int{"queued": n})
}

func (a *api) registerWorldRoutes(r chi.Router) {
	r.Get("/location", a.location)
	r.Put("/location", a.setLocation)
	r.Delete("/location", a.clearLocation)
	r.Get("/locations", a.locations)
	r.Get("/cities", a.searchCities)
	r.Get("/weather", a.weather)
	r.Get("/room/stats", a.roomStats)
	r.Get("/notes/hidden", a.hiddenNotes)
	r.Post("/notes/hidden/{id}/find", a.findNote)
	r.Post("/analysis/backfill", a.backfillAnalysis)
}

func (a *api) registerWorldAdminRoutes(r chi.Router) {
	r.Get("/notes", a.adminNotes)
	r.Post("/notes", a.createNote)
	r.Delete("/notes/{id}", a.deleteNote)
}
