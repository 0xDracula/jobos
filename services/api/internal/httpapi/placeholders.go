package httpapi

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"sort"
	"time"

	"jobbos/api/internal/store"
)

//go:embed placeholders
var placeholderFS embed.FS

type placeholderSet struct {
	Name  string
	Label string
	Seed  func(ctx context.Context, a *api, raw json.RawMessage) error
	Count func(ctx context.Context, a *api) (int, error)
	Admin string
}

var placeholderSets []placeholderSet

func registerPlaceholders(s placeholderSet) { placeholderSets = append(placeholderSets, s) }

func SeedPlaceholders(ctx context.Context, d Deps) error {
	a := &api{Deps: d}
	if a.pairStore() != nil {
		var admin *store.User
		for _, u := range a.allMembers(ctx) {
			if u.Role == "admin" {
				u := u
				admin = &u
				break
			}
		}
		if admin == nil {
			return nil
		}
		p, err := a.pairFor(ctx, admin.ID)
		if err != nil || p == nil {
			return err
		}
		ctx = withSpace(ctx, admin.ID, p)
	}
	for _, s := range placeholderSets {
		key := "placeholders." + s.Name
		var done map[string]any
		if a.setting(ctx, key, &done) {
			continue
		}
		raw, err := fs.ReadFile(placeholderFS, "placeholders/"+s.Name+".json")
		if err != nil {
			return fmt.Errorf("placeholders %s: %w", s.Name, err)
		}
		if err := s.Seed(ctx, a, raw); err != nil {
			return fmt.Errorf("seed placeholders %s: %w", s.Name, err)
		}
		mark, _ := json.Marshal(map[string]time.Time{"seeded_at": time.Now()})
		if err := a.Store.SetAppSetting(ctx, key, mark); err != nil {
			return err
		}
		a.Log.Info("placeholders seeded", "set", s.Name)
	}
	return nil
}

func seesPlaceholders(r *http.Request) bool { return isAdmin(r) }

func (a *api) adminPlaceholders(w http.ResponseWriter, r *http.Request) {
	type row struct {
		Name  string `json:"name"`
		Label string `json:"label"`
		Left  int    `json:"left"`
		Admin string `json:"admin"`
	}
	out := []row{}
	for _, s := range placeholderSets {
		n, err := s.Count(r.Context(), a)
		if err != nil {
			a.serverError(w, "count placeholders", err)
			return
		}
		out = append(out, row{Name: s.Name, Label: s.Label, Left: n, Admin: s.Admin})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Label < out[j].Label })
	writeJSON(w, http.StatusOK, map[string]any{"sets": out})
}
