package httpapi

import "github.com/go-chi/chi/v5"

type DatesStore interface{}

func (a *api) registerDatesRoutes(r chi.Router) {}

func (a *api) registerDatesAdminRoutes(r chi.Router) {}
