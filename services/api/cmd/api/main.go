package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"jobbos/api/internal/config"
	"jobbos/api/internal/db"
	"jobbos/api/internal/httpapi"
	"jobbos/api/internal/media"
	"jobbos/api/internal/store"
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	if err := run(log); err != nil {
		log.Error("api stopped", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	applied, err := db.Migrate(ctx, pool, cfg.MigrationsDir)
	if err != nil {
		return err
	}
	for _, name := range applied {
		log.Info("migration applied", "file", name)
	}

	st := store.New(pool)
	st.BackgroundDownloadInterval = cfg.BackgroundDownloadInterval
	admin, err := st.EnsureAdmin(ctx, cfg.AdminUsername, cfg.AdminDisplayName)
	if err != nil {
		return err
	}
	log.Info("acting as", "user", admin.Username)
	mediaService := media.New(cfg.MediaServiceURL)
	deps := httpapi.Deps{
		Store:       st,
		Media:       mediaService,
		Resolver:    mediaService,
		Links:       mediaService,
		MediaStatus: mediaService,
		CurrentUser: admin.ID,
		WebRoot:     cfg.WebRoot,
		MediaRoot:   cfg.MediaRoot,
		WorkerToken: cfg.WorkerToken,
		DevUI:       cfg.DevUI,
		Log:         log,
	}
	srv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           httpapi.New(deps),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		tick := time.NewTicker(30 * time.Minute)
		defer tick.Stop()
		for {
			httpapi.SyncPlaylists(ctx, deps, 6*time.Hour)
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
			}
		}
	}()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	log.Info("listening", "addr", cfg.ListenAddr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
