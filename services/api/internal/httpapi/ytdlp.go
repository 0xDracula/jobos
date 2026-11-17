package httpapi

import (
	"context"
	"net/http"
	"time"

	"jobbos/api/internal/store"
)

const ytdlpUpdateHour = 4

func ytdlpUpdateDue(now time.Time, last *time.Time, home *time.Location) bool {
	if last == nil {
		return true
	}
	since := now.Sub(*last)
	if home == nil {
		home = time.UTC
	}
	return since > 26*time.Hour || (now.In(home).Hour() == ytdlpUpdateHour && since > 12*time.Hour)
}

func ytdlpUpdateJob(priority int) store.JobSpec {
	return store.JobSpec{Kind: store.KindUpdateYtdlp, Payload: map[string]any{}, DedupeKey: store.YtdlpUpdateKey, Priority: priority}
}

func UpdateYtdlpNightly(ctx context.Context, d Deps, now time.Time) {
	last, err := d.Store.LastJobAt(ctx, store.KindUpdateYtdlp)
	if err != nil {
		d.Log.Warn("yt-dlp update schedule", "err", err)
		return
	}
	if !ytdlpUpdateDue(now, last, d.HomeTZ) {
		return
	}
	if _, _, err := d.Store.Enqueue(ctx, ytdlpUpdateJob(store.PriorityMatch)); err != nil {
		d.Log.Warn("queue yt-dlp update", "err", err)
	}
}

func (a *api) updateYtdlpNow(w http.ResponseWriter, r *http.Request) {
	id, added, err := a.Store.Enqueue(r.Context(), ytdlpUpdateJob(store.PriorityInteractive))
	if err != nil {
		a.serverError(w, "queue yt-dlp update", err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"job_id": id, "added": added})
}
