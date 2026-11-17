package httpapi

import "github.com/go-chi/chi/v5"

type MemoriesStore interface{}

func (a *api) registerMemoriesRoutes(r chi.Router) {}

func (a *api) registerMemoriesAdminRoutes(r chi.Router) {}
