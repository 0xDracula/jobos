package httpapi

import (
	"context"
	"fmt"
	"time"

	"jobbos/api/internal/store"
)

const allDayStart = 9 * time.Hour

const reminderWindow = time.Hour

type dueReminder struct {
	On    time.Time
	Start time.Time
}

func startOf(on time.Time, clock *string, loc *time.Location) time.Time {
	start := time.Date(on.Year(), on.Month(), on.Day(), 0, 0, 0, 0, loc).Add(allDayStart)
	if clock != nil {
		var h, m int
		if _, err := fmt.Sscanf(*clock, "%d:%d", &h, &m); err == nil {
			start = time.Date(on.Year(), on.Month(), on.Day(), h, m, 0, 0, loc)
		}
	}
	return start
}

func dueReminders(d store.ImportantDate, now time.Time, loc *time.Location) []dueReminder {
	if d.RemindMinutes == nil {
		return nil
	}
	day, ok := parseDay(d.Date)
	if !ok {
		return nil
	}
	lead := time.Duration(*d.RemindMinutes) * time.Minute
	today := civilDay(now, loc)
	var out []dueReminder
	for _, on := range occurrences(day, d.Recurring, today.AddDate(0, 0, -1), today.AddDate(0, 0, 31)) {
		start := startOf(on, d.Time, loc)
		at := start.Add(-lead)
		if !at.After(now) && now.Before(at.Add(reminderWindow)) {
			out = append(out, dueReminder{On: on, Start: start})
		}
	}
	return out
}

func reminderRecipients(d store.ImportantDate, members []store.User) []store.User {
	var out []store.User
	for _, u := range members {
		switch {
		case d.Surprise && (d.AuthorID == nil && u.Role != "admin" || d.AuthorID != nil && *d.AuthorID != u.ID):
		case d.Kind == "birthday" && d.UserID != nil && *d.UserID == u.ID:
		default:
			out = append(out, u)
		}
	}
	return out
}

func reminderWhen(r dueReminder, hasTime bool, now time.Time, loc *time.Location) string {
	days := int(r.On.Sub(civilDay(now, loc)).Hours() / 24)
	var when string
	switch {
	case days < 0:
		when = "Yesterday"
	case days == 0:
		when = "Today"
	case days == 1:
		when = "Tomorrow"
	default:
		when = fmt.Sprintf("In %d days", days)
	}
	if hasTime {
		when += ", " + r.Start.Format("15:04")
	}
	return when
}

func SendCalendarReminders(ctx context.Context, d Deps, now time.Time) {
	(&api{Deps: d}).forEachPair(ctx, func(ctx context.Context) { sendCalendarReminders(ctx, d, now) })
}

func sendCalendarReminders(ctx context.Context, d Deps, now time.Time) {
	a := &api{Deps: d}
	a.linkMemberBirthdays(ctx)
	dates, err := d.Store.ImportantDates(ctx, nil, false)
	if err != nil {
		d.Log.Warn("calendar reminders", "err", err)
		return
	}
	loc := a.homeTZ()
	var members []store.User
	for _, dt := range dates {
		due := dueReminders(dt, now, loc)
		if len(due) == 0 {
			continue
		}
		if members == nil {
			members = a.memberList(ctx)
		}
		for _, r := range due {
			for _, u := range reminderRecipients(dt, members) {
				sent, err := d.Store.MarkReminderSent(ctx, "date:"+dt.ID.String(), r.On, u.ID)
				if err != nil {
					d.Log.Warn("calendar reminder", "date", dt.ID, "err", err)
					continue
				}
				if sent {
					a.notify(u.ID, "dates", dt.Label, reminderWhen(r, dt.Time != nil, now, loc), "/calendar/?date="+dayString(r.On))
				}
			}
		}
	}
}
