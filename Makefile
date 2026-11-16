-include .env
export

MEDIA_ROOT ?= $(CURDIR)/.data/media
MIGRATIONS_DIR ?= $(CURDIR)/db/migrations
WEB_ROOT ?= $(CURDIR)/apps/web/out
COMPOSE := docker compose -f deploy/compose.dev.yaml

.PHONY: db-up db-down db-psql api media worker dev test test-api test-media

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

dev: db-up
	./tools/dev.sh

test: test-api test-media

test-api:
	cd services/api && go test ./...

test-media:
	cd services/media && uv run pytest -q

