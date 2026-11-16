import assert from "node:assert/strict";
import { test } from "node:test";

import { isWeekend, plantStage, progressOf, seasonAt, UNLOCKABLES, unlockedIds } from "./calendar.ts";
import { AREAS, clampToZone, DECORATIONS, DEFAULT_LAYOUT, parseLayout, placementOf } from "./layout.ts";
import { fallbackPlace, mixHex, moonPhaseName, phaseAt, skyAt, skyPoint } from "./sky.ts";

const CAIRO = { lat: 30.0444, lon: 31.2357 };

test("phases across a day in Cairo", () => {
  const at = (hhmm: string) => new Date(`2026-11-16T${hhmm}:00+02:00`);
  const phase = (hhmm: string) => skyAt(at(hhmm), CAIRO.lat, CAIRO.lon).phase;
  assert.equal(phase("03:00"), "night");
  assert.equal(phase("06:20"), "dawn");
  assert.equal(phase("12:00"), "day");
  assert.equal(phase("16:30"), "golden");
  assert.equal(phase("17:20"), "dusk");
  assert.equal(phase("21:00"), "night");
});

test("sky darkens continuously through dusk", () => {
  const start = new Date("2026-11-16T16:00:00+02:00").getTime();
  let lastNight = -1;
  for (let m = 0; m <= 150; m += 5) {
    const s = skyAt(new Date(start + m * 60_000), CAIRO.lat, CAIRO.lon);
    assert.ok(s.night >= lastNight - 1e-9, `night factor fell at +${m} min`);
    assert.ok(s.night - lastNight < 0.35 || lastNight < 0, `night factor jumped at +${m} min`);
    lastNight = s.night;
  }
  assert.ok(lastNight > 0.95);
});

test("lamp is off at noon and on at night", () => {
  assert.equal(skyAt(new Date("2026-11-16T12:00:00+02:00"), CAIRO.lat, CAIRO.lon).lamp, 0);
  assert.equal(skyAt(new Date("2026-11-16T22:00:00+02:00"), CAIRO.lat, CAIRO.lon).lamp, 1);
});

test("phase names without sunrise or sunset follow the sun", () => {
  assert.equal(phaseAt(new Date(), null, null, 10), "day");
  assert.equal(phaseAt(new Date(), null, null, -10), "night");
});

test("moon phase names", () => {
  assert.equal(moonPhaseName(0), "New moon");
  assert.equal(moonPhaseName(0.25), "First quarter");
  assert.equal(moonPhaseName(0.5), "Full moon");
  assert.equal(moonPhaseName(0.99), "New moon");
});

test("sky points follow compass azimuths", () => {
  assert.deepEqual(skyPoint(0, 180), { x: 0, y: 0 }); // south, on the horizon
  assert.equal(skyPoint(10, 90).x, -1); // east at the left edge
  assert.equal(skyPoint(10, 270).x, 1); // west at the right edge
  assert.equal(skyPoint(10, 20).x, -1); // behind the viewer clamps to the edge
  assert.equal(skyPoint(90, 123).y, 1);
  assert.equal(skyPoint(-5, 180).y, 0);
});

test("the sun sets in the west in Cairo", () => {
  const s = skyAt(new Date("2026-11-16T16:50:00+02:00"), CAIRO.lat, CAIRO.lon);
  assert.ok(s.sunAzimuth > 230 && s.sunAzimuth < 260, `azimuth ${s.sunAzimuth}`);
  assert.ok(s.sunAltitude > 0 && s.sunAltitude < 5, `altitude ${s.sunAltitude}`);
});

test("fallback place puts solar noon near the clock's noon", () => {
  const { lon } = fallbackPlace(new Date());
  assert.ok(lon >= -180 && lon <= 180);
});

test("mixHex blends colors", () => {
  assert.equal(mixHex("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(mixHex("#ff0000", "#0000ff", 0), "#ff0000");
});

test("seasons follow the hemisphere", () => {
  assert.equal(seasonAt(new Date("2026-11-16"), 30), "autumn");
  assert.equal(seasonAt(new Date("2026-01-10"), 30), "winter");
  assert.equal(seasonAt(new Date("2026-01-10"), -33), "summer");
  assert.equal(seasonAt(new Date("2026-04-10"), -33), "autumn");
});

test("weekend is Friday and Saturday", () => {
  assert.equal(isWeekend(new Date("2026-11-20T12:00:00")), true); // Friday
  assert.equal(isWeekend(new Date("2026-11-21T12:00:00")), true); // Saturday
  assert.equal(isWeekend(new Date("2026-11-22T12:00:00")), false); // Sunday
});

test("plants grow with listening hours", () => {
  assert.equal(plantStage(0), 0);
  assert.equal(plantStage(0.5), 0);
  assert.equal(plantStage(1), 1);
  assert.equal(plantStage(19), 2);
  assert.equal(plantStage(500), 4);
});

test("unlockables open at their thresholds", () => {
  const none = unlockedIds({ hours: 0, likes: 0, days: 0 });
  assert.equal(none.size, 0);
  const some = unlockedIds({ hours: 12, likes: 0, days: 7 });
  assert.deepEqual([...some].sort(), ["fairy_jar", "moon_lamp"]);
  const jar = UNLOCKABLES.find((u) => u.id === "fairy_jar")!;
  assert.equal(progressOf(jar, { hours: 5, likes: 0, days: 0 }), 0.5);
});

test("saved layouts keep known styles and drop the rest", () => {
  assert.deepEqual(parseLayout(null), DEFAULT_LAYOUT);
  const l = parseLayout({ look: { wall: "mint", floor: "lava", accent: "#123456" }, items: { rug: { x: 999, y: -5, flip: true, variant: 9 }, ghost: { x: 1, y: 1 } } });
  assert.equal(l.look.wall, "mint");
  assert.equal(l.look.floor, DEFAULT_LAYOUT.look.floor);
  assert.equal(l.look.accent, "#123456");
  const [x0, x1, y0, y1] = AREAS.inside;
  assert.deepEqual([l.items.rug.x, l.items.rug.y], [x1, y0]);
  assert.equal(l.items.rug.flip, true);
  assert.equal(l.items.rug.variant, undefined);
  assert.equal("ghost" in l.items, false);
  assert.ok(x0 < x1 && y0 < y1);
});

test("decorations stay in their zone", () => {
  assert.deepEqual(clampToZone("roof", 0, 0), [AREAS.roof[0], AREAS.roof[2]]);
  for (const d of DECORATIONS) {
    const p = placementOf(d);
    assert.deepEqual(clampToZone(d.zone, p.x, p.y), [p.x, p.y], `${d.id} starts outside its zone`);
  }
});
