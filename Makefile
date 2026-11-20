-include .env
export

MEDIA_ROOT ?= $(CURDIR)/.data/media
MIGRATIONS_DIR ?= $(CURDIR)/db/migrations
WEB_ROOT ?= $(CURDIR)/apps/web/out
GEOIP_DB ?= $(CURDIR)/.data/geo/dbip-city-lite.mmdb
MAP_DIR ?= $(CURDIR)/.data/map
MODELS_DIR ?= $(CURDIR)/.data/models
COMPOSE := docker compose -f deploy/compose.dev.yaml

.PHONY: db-up db-down db-psql api media worker worker-heavy dev web web-install web-build geoip map models test test-api test-media test-web deploy

db-up:
	$(COMPOSE) up -d --wait

db-down:
	$(COMPOSE) down

db-psql:
	$(COMPOSE) exec db psql -U jobbos jobbos

api:
	cd services/api && go run ./cmd/api

media:
	cd services/media && uv run uvicorn jobbos_media.app:app --host 127.0.0.1 --port 8001

worker:
	cd services/media && uv run python -m jobbos_media.worker

worker-heavy:
	cd services/media && uv run python -m jobbos_media.worker --queue heavy

dev: db-up
	./tools/dev.sh

web:
	cd apps/web && npm run dev

web-install:
	cd apps/web && npm ci

web-build:
	cd apps/web && npm run build

geoip:
	./tools/update-geoip.sh

map:
	./tools/fetch-map.sh

models:
	./tools/fetch-models.sh

test: test-api test-media test-web

test-api:
	cd services/api && go test ./...

test-media:
	cd services/media && uv run pytest -q

test-web:
	cd apps/web && npm run typecheck && npm test


deploy:
	./tools/deploy.sh
