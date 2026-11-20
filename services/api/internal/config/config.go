package config

import (
	"fmt"
	"os"
	"strings"
	"time"
)

type Config struct {
	DatabaseURL                string
	ListenAddr                 string
	MediaServiceURL            string
	MediaRoot                  string
	BackupDir                  string
	BackupScript               string
	MigrationsDir              string
	WorkerToken                string
	DevUI                      bool
	BackgroundDownloadInterval time.Duration
	AdminUsername              string
	AdminDisplayName           string
	AdminPasswordHash          string
	WebRoot                    string
	GeoIPDB                    string
	HomeTZ                     string
	WSOrigins                  []string
	VAPIDPublicKey             string
	VAPIDPrivateKey            string
	VAPIDSubject               string
	SecureCookies              bool
}

func Load() (Config, error) {
	c := Config{
		DatabaseURL:       os.Getenv("DATABASE_URL"),
		ListenAddr:        getenv("LISTEN_ADDR", "127.0.0.1:8080"),
		MediaServiceURL:   getenv("MEDIA_SERVICE_URL", "http://127.0.0.1:8001"),
		MediaRoot:         os.Getenv("MEDIA_ROOT"),
		BackupDir:         os.Getenv("BACKUP_DIR"),
		BackupScript:      os.Getenv("BACKUP_SCRIPT"),
		MigrationsDir:     os.Getenv("MIGRATIONS_DIR"),
		WorkerToken:       os.Getenv("WORKER_TOKEN"),
		DevUI:             os.Getenv("DEV_UI") == "1",
		AdminUsername:     os.Getenv("ADMIN_USERNAME"),
		AdminDisplayName:  os.Getenv("ADMIN_DISPLAY_NAME"),
		AdminPasswordHash: os.Getenv("ADMIN_PASSWORD_HASH"),
		WebRoot:           os.Getenv("WEB_ROOT"),
		GeoIPDB:           os.Getenv("GEOIP_DB"),
		HomeTZ:            getenv("HOME_TZ", "Africa/Cairo"),
		VAPIDPublicKey:    os.Getenv("VAPID_PUBLIC_KEY"),
		VAPIDPrivateKey:   os.Getenv("VAPID_PRIVATE_KEY"),
		VAPIDSubject:      getenv("VAPID_SUBJECT", "https://jobbos.app"),
		SecureCookies:     strings.HasPrefix(os.Getenv("PUBLIC_URL"), "https://"),
	}
	for _, o := range strings.Split(os.Getenv("WS_ORIGINS"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			c.WSOrigins = append(c.WSOrigins, o)
		}
	}
	required := []struct{ name, value string }{
		{"DATABASE_URL", c.DatabaseURL},
		{"MEDIA_ROOT", c.MediaRoot},
		{"MIGRATIONS_DIR", c.MigrationsDir},
		{"WORKER_TOKEN", c.WorkerToken},
	}
	for _, r := range required {
		if r.value == "" {
			return c, fmt.Errorf("%s is not set", r.name)
		}
	}
	interval, err := time.ParseDuration(getenv("BACKGROUND_DOWNLOAD_INTERVAL", "20s"))
	if err != nil || interval < 0 {
		return c, fmt.Errorf("BACKGROUND_DOWNLOAD_INTERVAL must be a duration such as 20s")
	}
	c.BackgroundDownloadInterval = interval
	return c, nil
}

func getenv(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
