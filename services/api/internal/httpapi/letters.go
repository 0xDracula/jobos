package httpapi

import "github.com/go-chi/chi/v5"

type LettersStore interface{}

func (a *api) registerLettersRoutes(r chi.Router) {}

func (a *api) registerLettersAdminRoutes(r chi.Router) {}
