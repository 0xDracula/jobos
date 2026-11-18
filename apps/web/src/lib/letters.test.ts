import assert from "node:assert/strict";
import { test } from "node:test";

import { coveredByUpload, fontFaceCss, handFontFamily, readyFonts } from "./handwriting.ts";
import { daysBetween, formatDay, groupReceived, groupWritten, jarPapers, msUntil, splitByDate, todayIn, zoneCity, type LetterSummary } from "./paper.ts";

const ME = "01900000-0000-7000-8000-000000000001";
const HER = "01900000-0000-7000-8000-000000000002";
const SHA = "a".repeat(64);

test("uploaded handwriting fonts never cover Arabic", () => {
  assert.equal(coveredByUpload("a".codePointAt(0)!), true);
  assert.equal(coveredByUpload("é".codePointAt(0)!), true);
  assert.equal(coveredByUpload("ب".codePointAt(0)!), false);
  assert.equal(coveredByUpload("،".codePointAt(0)!), false);
  assert.equal(coveredByUpload(0xfeff), false); // Arabic presentation forms B
  assert.equal(coveredByUpload(0xfb50), false); // Arabic presentation forms A
  assert.equal(coveredByUpload("♥".codePointAt(0)!), true);
});

test("font faces and the fallback chain", () => {
  const fonts = [
    { user_id: ME, url: `/api/fonts/${SHA}.woff2`, status: "ready" },
    { user_id: HER, url: null, status: "processing" },
    { user_id: "not-a-uuid", url: `/api/fonts/${SHA}.woff2`, status: "ready" },
  ];
  const ready = readyFonts(fonts);
  assert.deepEqual([...ready], [ME]);
  assert.equal(handFontFamily(ME, ready), `"jobbos-hand-${ME}", var(--stack-hand, cursive)`);
  assert.equal(handFontFamily(HER, ready), "var(--stack-hand, cursive)");
  const css = fontFaceCss(fonts);
  assert.equal(css.split("@font-face").length - 1, 1);
  assert.match(css, /unicode-range:U\+0000-05FF/);
  assert.match(css, new RegExp(`/api/fonts/${SHA}\\.woff2`));
  assert.equal(fontFaceCss([{ user_id: ME, url: "/evil.css\");x{", status: "ready" }]), "");
});

const letter = (over: Partial<LetterSummary>): LetterSummary => ({
  kind: "standard",
  author_id: HER,
  status: "published",
  locked: false,
  created_at: "2026-11-01T10:00:00Z",
  unlock_at: null,
  ...over,
});

test("received letters: open-when in writing order, sealed by unlock, the rest newest first", () => {
  const ow1 = letter({ kind: "open_when", created_at: "2026-11-02T00:00:00Z" });
  const ow2 = letter({ kind: "open_when", created_at: "2026-11-01T00:00:00Z" });
  const late = letter({ kind: "time_locked", locked: true, unlock_at: "2027-10-01T00:00:00Z" });
  const soon = letter({ kind: "time_locked", locked: true, unlock_at: "2027-08-04T00:00:00Z" });
  const opened = letter({ kind: "time_locked", locked: false, unlock_at: "2026-11-10T00:00:00Z", created_at: "2026-10-01T00:00:00Z" });
  const plain = letter({ created_at: "2026-11-05T00:00:00Z" });
  const draft = letter({ status: "draft" });
  const mine = letter({ author_id: ME });
  const g = groupReceived([ow1, ow2, late, soon, opened, plain, draft, mine], ME);
  assert.deepEqual(g.openWhen, [ow2, ow1]);
  assert.deepEqual(g.sealed, [soon, late]);
  assert.deepEqual(g.letters, [opened, plain]);
});

test("written letters: drafts apart, then each kind", () => {
  const d = letter({ author_id: ME, status: "draft" });
  const t = letter({ author_id: ME, kind: "time_locked", unlock_at: "2027-01-01T00:00:00Z" });
  const w = letter({ author_id: ME, kind: "welcome" });
  const theirs = letter({});
  const g = groupWritten([d, t, w, theirs], ME);
  assert.deepEqual(g.drafts, [d]);
  assert.deepEqual(g.timeLocked, [t]);
  assert.deepEqual(g.welcome, [w]);
  assert.deepEqual(g.letters, []);
});

test("dates", () => {
  assert.equal(daysBetween("2026-11-17", "2027-10-01"), 318);
  assert.equal(daysBetween("2026-12-31", "2027-01-01"), 1);
  assert.equal(formatDay("2027-10-01", undefined, "en-GB"), "1 October 2027");
  assert.equal(todayIn("Africa/Cairo", new Date("2026-11-17T22:30:00Z")), "2026-11-18");
  assert.equal(todayIn("Africa/Cairo", new Date("2026-11-17T21:30:00Z")), "2026-11-17");
  assert.equal(zoneCity("America/New_York"), "New York");
  assert.equal(jarPapers(-1), 0);
  assert.equal(jarPapers(4), 4);
  assert.equal(jarPapers(30), 9);
  const s = splitByDate([{ date: "2026-11-16" }, { date: "2026-11-19" }, { date: "2026-11-17" }, { date: "2026-11-10" }], "2026-11-17");
  assert.deepEqual(s.upcoming.map((x) => x.date), ["2026-11-17", "2026-11-19"]);
  assert.deepEqual(s.past.map((x) => x.date), ["2026-11-16", "2026-11-10"]);
  assert.equal(msUntil(null), null);
  assert.equal(msUntil("2026-11-17T10:00:05Z", Date.parse("2026-11-17T10:00:00Z")), 5000);
  assert.equal(msUntil("2026-11-17T09:00:00Z", Date.parse("2026-11-17T10:00:00Z")), 1000);
});
