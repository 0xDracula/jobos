package config

import (
	"fmt"
	"os"
)

type Config struct {
	DatabaseURL     string
	ListenAddr      string
	MediaServiceURL string
	MediaRoot       string
	MigrationsDir   string
	WorkerToken     string
}

func Load() (Config, error) {
	c := Config{
		DatabaseURL:     os.Getenv("DATABASE_URL"),
		ListenAddr:      getenv("LISTEN_ADDR", "127.0.0.1:8080"),
		MediaServiceURL: getenv("MEDIA_SERVICE_URL", "http://127.0.0.1:8001"),
		MediaRoot:       os.Getenv("MEDIA_ROOT"),
		MigrationsDir:   os.Getenv("MIGRATIONS_DIR"),
		WorkerToken:     os.Getenv("WORKER_TOKEN"),
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
	return c, nil
}

func getenv(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
