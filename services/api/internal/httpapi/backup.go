package httpapi

import (
	"context"
	"encoding/json"
	"os/exec"
	"strings"
	"time"
)

const backupHour = 3

type BackupStatus struct {
	At      time.Time `json:"at"`
	OK      bool      `json:"ok"`
	Message string    `json:"message"`
}

func backupDue(now time.Time, last *BackupStatus, home *time.Location) bool {
	if last == nil || last.At.IsZero() {
		return true
	}
	since := now.Sub(last.At)
	if !last.OK {
		return since > time.Hour
	}
	if home == nil {
		home = time.UTC
	}
	return since > 26*time.Hour || (now.In(home).Hour() == backupHour && since > 12*time.Hour)
}

func lastBackup(ctx context.Context, d Deps) *BackupStatus {
	raw, err := d.Store.AppSetting(ctx, "backup.last")
	if err != nil || raw == nil {
		return nil
	}
	var s BackupStatus
	if json.Unmarshal(raw, &s) != nil {
		return nil
	}
	return &s
}

func RunBackupNightly(ctx context.Context, d Deps, script, dir string, now time.Time) {
	if d.Store == nil || !backupDue(now, lastBackup(ctx, d), d.HomeTZ) {
		return
	}
	run, cancel := context.WithTimeout(ctx, 2*time.Hour)
	defer cancel()
	out, err := exec.CommandContext(run, "bash", script, dir).CombinedOutput()
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	st := BackupStatus{At: now, OK: err == nil, Message: lines[len(lines)-1]}
	if err != nil {
		st.Message = strings.TrimSpace(err.Error() + ": " + st.Message)
		d.Log.Warn("backup", "err", err, "output", string(out))
	} else {
		d.Log.Info("backup", "result", st.Message)
	}
	raw, _ := json.Marshal(st)
	if err := d.Store.SetAppSetting(ctx, "backup.last", raw); err != nil {
		d.Log.Warn("save backup status", "err", err)
	}
}
