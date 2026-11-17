package httpapi

import (
	"testing"
	"time"
)

func TestBackupDue(t *testing.T) {
	cairo, err := time.LoadLocation("Africa/Cairo")
	if err != nil {
		t.Skip("no tzdata")
	}
	at := func(s string) time.Time {
		v, _ := time.ParseInLocation("2006-01-02 15:04", s, cairo)
		return v
	}
	ok := func(s string) *BackupStatus { return &BackupStatus{At: at(s), OK: true} }
	for _, c := range []struct {
		now  string
		last *BackupStatus
		want bool
	}{
		{"2026-11-17 03:10", nil, true},
		{"2026-11-18 03:10", ok("2026-11-17 03:10"), true},
		{"2026-11-17 14:00", ok("2026-11-17 03:10"), false},
		{"2026-11-18 06:00", ok("2026-11-17 03:10"), true},
		{"2026-11-17 03:50", &BackupStatus{At: at("2026-11-17 03:10"), OK: false}, false},
		{"2026-11-17 04:20", &BackupStatus{At: at("2026-11-17 03:10"), OK: false}, true},
	} {
		if got := backupDue(at(c.now), c.last, cairo); got != c.want {
			t.Errorf("backupDue(%s, %+v) = %v, want %v", c.now, c.last, got, c.want)
		}
	}
}
