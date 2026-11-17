import assert from "node:assert/strict";
import { test } from "node:test";

import { addDays, addMonths, dateIdOf, daysBetween, fmtHours, isDay, monthEnd, monthGrid, relativeDays, reminderLabel, reminderOptions } from "./dateMath.ts";

test("day arithmetic across months, years and leap days", () => {
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-03-01", -1), "2028-02-29");
  assert.equal(daysBetween("2026-11-17", "2026-12-03"), 16);
  assert.equal(daysBetween("2026-12-03", "2026-11-17"), -16);
  assert.equal(addMonths("2026-11-17", 1), "2026-12-01");
  assert.equal(addMonths("2026-01-31", -1), "2025-12-01");
  assert.equal(monthEnd("2028-02-10"), "2028-02-29");
});

test("a month grid covers whole weeks from Sunday to Saturday", () => {
  const grid = monthGrid("2026-11-01");
  assert.equal(grid.length % 7, 0);
  assert.equal(grid[0].day, "2026-11-01"); // 1 November 2026 is a Sunday
  assert.equal(grid.at(-1)!.day, "2026-12-05");
  assert.equal(grid.filter((c) => c.inMonth).length, 30);
  const dec = monthGrid("2026-12-01");
  assert.equal(dec[0].day, "2026-11-29");
  assert.equal(dec[0].inMonth, false);
});

test("relative days and reminder labels", () => {
  assert.equal(relativeDays(0), "Today");
  assert.equal(relativeDays(1), "Tomorrow");
  assert.equal(relativeDays(16), "In 16 days");
  assert.equal(relativeDays(-3), "3 days ago");
  assert.deepEqual(
    reminderOptions(false).map(([m]) => m),
    [null, 0, 1440, 10080],
  );
  assert.equal(reminderLabel(60, true), "1 hour before");
  assert.equal(reminderLabel(2880, false), "2 days before");
  assert.equal(reminderLabel(null, false), "None");
});

test("calendar event ids lead back to stored dates", () => {
  assert.equal(dateIdOf("date:0190-abc:2027"), "0190-abc");
  assert.equal(dateIdOf("date:0190-abc"), "0190-abc");
  assert.equal(dateIdOf("letter:0190-abc"), null);
});

test("only real days pass, and a bad month gives an empty grid", () => {
  assert.equal(isDay("2026-11-17"), true);
  assert.equal(isDay("2028-02-29"), true);
  assert.equal(isDay("2026-02-29"), false);
  assert.equal(isDay("x"), false);
  assert.deepEqual(monthGrid("x"), []);
});

test("minutes as hours", () => {
  assert.equal(fmtHours(45), "45 min");
  assert.equal(fmtHours(120), "2 h");
  assert.equal(fmtHours(1505), "25 h 5 min");
});
