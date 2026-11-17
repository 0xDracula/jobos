import assert from "node:assert/strict";
import { test } from "node:test";

import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";

import { fmtDay, fmtDayRange, parseDay, tilt } from "./days.ts";
import { MAP_PALETTES, mapStyle } from "./mapStyle.ts";
import { beatInterval, beatsPerSlide, kenBurns, nextChangeAt, SLIDE_MS } from "./slideshow.ts";

test("days are local dates", () => {
  const d = parseDay("2026-08-04");
  assert.equal(d?.getFullYear(), 2026);
  assert.equal(d?.getMonth(), 7);
  assert.equal(d?.getDate(), 4);
  assert.equal(parseDay("2026-02-30"), null);
  assert.equal(parseDay("4 August"), null);
  assert.equal(fmtDay("2026-08-04"), "4 August 2026");
  assert.equal(fmtDay("2026-08-04", { short: true }), "4 August");
  assert.equal(fmtDay(null), "");
  assert.equal(fmtDayRange("2026-02-14", "2026-03-31"), "14 February – 31 March 2026");
  assert.equal(fmtDayRange("2025-12-03", "2026-01-02"), "3 December 2025 – 2 January 2026");
  assert.equal(fmtDayRange("2026-08-05", null), "5 August 2026 – now");
  assert.equal(fmtDayRange(null, null), "");
});

test("polaroid tilts are stable and small", () => {
  assert.equal(tilt("a"), tilt("a"));
  for (const id of ["a", "b", "0199f0c2-1111-7000-8000-000000000001", "قطتي"]) assert.ok(Math.abs(tilt(id)) <= 4);
});

test("slides last whole bars close to six seconds", () => {
  const beats = Array.from({ length: 200 }, (_, i) => 1000 + i * 500);
  assert.equal(beatInterval(beats), 500);
  assert.equal(beatsPerSlide(500), 12);
  assert.equal(beatsPerSlide(750), 8);
  assert.equal(beatsPerSlide(5000), 4);
  assert.equal(nextChangeAt(beats, 6000), 12000);
  assert.equal(nextChangeAt(beats, 5950), 12000);
  assert.ok(beats.includes(nextChangeAt(beats, 6210)));
  const last = beats[beats.length - 1];
  assert.equal(nextChangeAt(beats, last - 2000), last + 8 * 500);
  assert.equal(nextChangeAt(null, 1234), 1234 + SLIDE_MS);
  assert.equal(nextChangeAt([100, 600, 1100], 0), SLIDE_MS);
});

test("the beat interval ignores a missed beat", () => {
  assert.equal(beatInterval([0, 500, 1000, 2000, 2500, 3000]), 500);
  assert.equal(beatInterval([0]), null);
});

test("ken burns alternates zooming in and out", () => {
  const a = kenBurns(0);
  const b = kenBurns(1);
  assert.ok(a.to.scale > a.from.scale);
  assert.ok(b.to.scale < b.from.scale);
  for (const k of [a, b, kenBurns(2), kenBurns(3)]) {
    for (const p of [k.from, k.to]) assert.ok(p.scale >= 1 && Math.abs(p.x) <= 4 && Math.abs(p.y) <= 4);
  }
});

test("the map style is valid and only uses the app's own URLs", () => {
  for (const theme of ["day", "night"] as const) {
    const style = mapStyle(theme, "https://jobbos.example");
    const errors = validateStyleMin(style as any);
    assert.deepEqual(errors.map((e: { message: string }) => e.message), []);
    const urls = JSON.stringify(style).match(/(pmtiles:\/\/)?https?:\/\/[^"\s<]+/g) ?? [];
    const own = urls.filter((u) => !u.includes("openstreetmap.org/copyright") && !u.includes("protomaps.com"));
    assert.ok(own.length >= 2);
    for (const u of own) assert.match(u, /^(pmtiles:\/\/)?https:\/\/jobbos\.example\/api\/map\//);
  }
  assert.deepEqual(Object.keys(MAP_PALETTES.day).sort(), Object.keys(MAP_PALETTES.night).sort());
});
