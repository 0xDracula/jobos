package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/jackc/pgx/v5/pgxpool"

	"jobbos/api/internal/auth"
	"jobbos/api/internal/config"
	"jobbos/api/internal/db"
	"jobbos/api/internal/httpapi"
	"jobbos/api/internal/media"
	"jobbos/api/internal/realtime"
	"jobbos/api/internal/store"
	"jobbos/api/internal/world"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "hash-password" {
		line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
		hash, err := auth.HashPassword(strings.TrimRight(line, "\r\n"))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println(hash)
		return
	}
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

	owner, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	applied, err := db.Migrate(ctx, owner, cfg.MigrationsDir)
	owner.Close()
	if err != nil {
		return err
	}
	for _, name := range applied {
		log.Info("migration applied", "file", name)
	}
	poolCfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return err
	}
	store.ConfigurePool(poolCfg)
	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return err
	}
	defer pool.Close()

	st := store.New(pool)
	st.BackgroundDownloadInterval = cfg.BackgroundDownloadInterval
	admin, err := st.EnsureAdmin(ctx, cfg.AdminUsername, cfg.AdminDisplayName)
	if err != nil {
		return err
	}
	if err := seedAdminPassword(ctx, st, admin, cfg.AdminPasswordHash, log); err != nil {
		return err
	}
	mediaService := media.New(cfg.MediaServiceURL)
	locator, err := world.OpenLocator(cfg.GeoIPDB)
	if err != nil {
		return err
	}
	defer locator.Close()
	if locator == nil {
		log.Info("city detection off: no GeoIP database", "path", cfg.GeoIPDB)
	}
	home, err := time.LoadLocation(cfg.HomeTZ)
	if err != nil {
		return fmt.Errorf("HOME_TZ: %w", err)
	}
	hub := realtime.NewHub(log)
	hub.OriginPatterns = cfg.WSOrigins
	go hub.Run(ctx)
	push, err := pushKeys(ctx, st, cfg)
	if err != nil {
		return err
	}
	deps := httpapi.Deps{
		Hub:           hub,
		Push:          push,
		HomeTZ:        home,
		Store:         st,
		Media:         mediaService,
		Resolver:      mediaService,
		Links:         mediaService,
		MediaStatus:   mediaService,
		World:         world.NewOpenMeteo(),
		WebRoot:       cfg.WebRoot,
		MediaRoot:     cfg.MediaRoot,
		WorkerToken:   cfg.WorkerToken,
		DevUI:         cfg.DevUI,
		SecureCookies: cfg.SecureCookies,
		Log:           log,
	}
	if locator != nil {
		deps.Locator = locator
	}
	if err := httpapi.SeedPlaceholders(ctx, deps); err != nil {
		log.Error("seed placeholders", "err", err)
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
		tick := time.NewTicker(10 * time.Minute)
		defer tick.Stop()
		for {
			httpapi.UpdateYtdlpNightly(ctx, deps, time.Now())
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
			}
		}
	}()
	go func() {
		tick := time.NewTicker(5 * time.Minute)
		defer tick.Stop()
		for {
			httpapi.SendCalendarReminders(ctx, deps, time.Now())
			httpapi.SendSessionReminders(ctx, deps, time.Now())
			httpapi.SendSwapReveal(ctx, deps, time.Now())
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
			}
		}
	}()
	go func() {
		tick := time.NewTicker(5 * time.Minute)
		defer tick.Stop()
		for {
			httpapi.RefreshRecommendations(ctx, deps, time.Now())
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
			}
		}
	}()
	if cfg.BackupDir != "" {
		script := cfg.BackupScript
		if script == "" {
			script = filepath.Join(filepath.Dir(filepath.Dir(cfg.MigrationsDir)), "tools", "backup.sh")
		}
		go func() {
			tick := time.NewTicker(10 * time.Minute)
			defer tick.Stop()
			for {
				httpapi.RunBackupNightly(ctx, deps, script, cfg.BackupDir, time.Now())
				select {
				case <-ctx.Done():
					return
				case <-tick.C:
				}
			}
		}()
	}
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

func seedAdminPassword(ctx context.Context, st *store.Store, admin *store.User, hash string, log *slog.Logger) error {
	if hash != "" {
		set, err := st.SeedAdminPassword(ctx, admin.ID, hash)
		if err == nil && set {
			log.Info("admin password set from ADMIN_PASSWORD_HASH", "user", admin.Username)
		}
		return err
	}
	_, current, err := st.Login(ctx, admin.Username)
	if err != nil || current != "" {
		return err
	}
	token, tokenHash, err := auth.NewToken()
	if err != nil {
		return err
	}
	if err := st.CreatePasswordReset(ctx, admin.ID, tokenHash, auth.ResetTTL); err != nil {
		return err
	}
	log.Warn("admin has no password: open this link to set it (valid 24 h)", "user", admin.Username, "path", "/reset/"+token)
	return nil
}

func pushKeys(ctx context.Context, st *store.Store, cfg config.Config) (*httpapi.PushKeys, error) {
	if cfg.VAPIDPublicKey != "" && cfg.VAPIDPrivateKey != "" {
		return &httpapi.PushKeys{PublicKey: cfg.VAPIDPublicKey, PrivateKey: cfg.VAPIDPrivateKey, Subject: cfg.VAPIDSubject}, nil
	}
	var keys struct {
		Public  string `json:"public"`
		Private string `json:"private"`
	}
	raw, err := st.AppSetting(ctx, "vapid")
	if err != nil {
		return nil, err
	}
	if raw == nil || json.Unmarshal(raw, &keys) != nil || keys.Public == "" {
		keys.Private, keys.Public, err = webpush.GenerateVAPIDKeys()
		if err != nil {
			return nil, err
		}
		body, _ := json.Marshal(keys)
		if err := st.SetAppSetting(ctx, "vapid", body); err != nil {
			return nil, err
		}
	}
	return &httpapi.PushKeys{PublicKey: keys.Public, PrivateKey: keys.Private, Subject: cfg.VAPIDSubject}, nil
}
