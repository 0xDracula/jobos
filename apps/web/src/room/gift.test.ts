import assert from "node:assert/strict";
import { test } from "node:test";

import { lookOf, parseLook, recolor, shift, toHsl } from "../avatar/look.ts";
import { holidayDecorations, inHoliday, isUnlocked, milestoneToday, progressOf, unlockedIds, weekendMorning, type MilestoneDay, type Unlockable } from "./calendar.ts";
import { colorsOf, DEFAULT_FAVORITES, favoriteArt, hasWord, normalize } from "./favorites.ts";
import { ACCENT_AUTO, parseLayout, resolveAccent } from "./layout.ts";
import { ALBUM_BLEND, distance, LAMP_LIGHT, moodLight, NEUTRAL_LIGHT } from "./light.ts";
import { layoutStars, monthOf } from "./starmap.ts";

test("favorite flowers map in English and Arabic", () => {
  assert.equal(favoriteArt({ flowers: ["Roses"] }).flower, "rose");
  assert.equal(favoriteArt({ flowers: ["الورد البلدي"] }).flower, "rose");
  assert.equal(favoriteArt({ flowers: ["عباد الشمس"] }).flower, "sunflower");
  assert.equal(favoriteArt({ flowers: ["ياسمين"] }).flower, "jasmine");
  assert.equal(favoriteArt({ flowers: ["cherry blossoms"] }).flower, "blossom");
  assert.equal(favoriteArt({ flowers: ["something rare"] }).flower, "default");
});

test("the first favorite with art wins", () => {
  assert.equal(favoriteArt({ flowers: ["peonies?", "tulips"] }).flower, "tulip");
  assert.equal(favoriteArt({ food: ["فلفل", "كنافة"] }).food, "sweets");
});

test("favorite colors become the accent and the book spines", () => {
  const art = favoriteArt({ colors: ["لبني", "Pink", "pink", "teal"] });
  assert.equal(art.accent, "#4985cc");
  assert.deepEqual(art.books, ["#4985cc", "#e88fa3", "#3aa6a0"]);
  assert.deepEqual(colorsOf(["أزرق"]), ["#4985cc"]);
  assert.equal(favoriteArt({ colors: ["plaid"] }).accent, null);
});

test("places, films, artists, food and drinks map by keyword", () => {
  const art = favoriteArt({
    places: ["الإسكندرية"],
    films: ["Spirited Away"],
    artists: ["أم كلثوم"],
    food: ["Strawberry cheesecake"],
    drinks: ["قهوة تركي"],
  });
  assert.equal(art.place, "sea");
  assert.equal(art.film, "spirit");
  assert.equal(art.artist, "tarab");
  assert.equal(art.food, "cake");
  assert.equal(art.drink, "coffee");
  assert.deepEqual(favoriteArt(null), DEFAULT_FAVORITES);
});

test("keywords match whole words only", () => {
  assert.equal(hasWord(normalize("فلفل حار"), "فل"), false);
  assert.equal(hasWord(normalize("الفل"), "فل"), true);
  assert.equal(hasWord(normalize("I love tea"), "tea"), true);
  assert.equal(hasWord(normalize("steak"), "tea"), false);
  assert.equal(normalize("وردةٌ"), "ورده");
});

test("the accent follows the favorite color until one is chosen", () => {
  assert.equal(parseLayout(null).look.accent, ACCENT_AUTO);
  assert.equal(resolveAccent(ACCENT_AUTO, "#4985cc"), "#4985cc");
  assert.equal(resolveAccent(ACCENT_AUTO, null), "#e88fa3");
  assert.equal(resolveAccent("#123456", "#4985cc"), "#123456");
  assert.equal(parseLayout({ room: "cabin" }).room, "cabin");
  assert.equal(parseLayout({ room: "moon base" }).room, "rooftop");
});

test("room light moves at most 20% toward the album", () => {
  const palette = [{ hex: "#2050ff", weight: 0.6, lab: [40, 30, -80] as [number, number, number] }];
  const lit = moodLight(palette, null, null);
  assert.ok(distance(lit.color, LAMP_LIGHT) <= ALBUM_BLEND + 0.01, `moved ${distance(lit.color, LAMP_LIGHT)}`);
  assert.notEqual(lit.color, LAMP_LIGHT);
  assert.deepEqual(moodLight(undefined, null, null), NEUTRAL_LIGHT);
});

test("calm songs are dimmer and softer, energetic songs brighter", () => {
  const calm = moodLight(null, 0.1, 0.5);
  const lively = moodLight(null, 0.9, 0.5);
  assert.ok(calm.level < 1 && lively.level > 1);
  assert.ok(calm.spread > lively.spread);
  assert.equal(moodLight(null, null, null).level, 1);
});

test("stars of one month form one constellation", () => {
  const points = [
    { id: "a", at: "2026-11-02T10:00:00Z" },
    { id: "b", at: "2026-11-20T10:00:00Z" },
    { id: "c", at: "2026-12-05T10:00:00Z" },
    { id: "d", at: "2026-11-10T10:00:00Z" },
  ];
  const l = layoutStars(points);
  assert.equal(l.stars.length, 4);
  assert.deepEqual(l.months.map((m) => m.month), [monthOf("2026-11-02T10:00:00Z"), monthOf("2026-12-05T10:00:00Z")]);
  assert.equal(l.lines.length, 2);
  for (const s of l.stars) assert.ok(s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1);
  assert.deepEqual(layoutStars(points), l);
  const nov = l.stars.filter((s) => s.month === l.months[0].month);
  const dec = l.stars.filter((s) => s.month === l.months[1].month);
  assert.ok(Math.max(...nov.map((s) => s.x)) < Math.min(...dec.map((s) => s.x)));
});

test("star layouts keep the newest months", () => {
  const points = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, at: `2026-${String(i + 1).padStart(2, "0")}-15T12:00:00Z` }));
  const l = layoutStars(points, { maxMonths: 3 });
  assert.equal(l.months.length, 3);
  assert.equal(l.months[2].month, "2026-10");
});

test("milestone decorations unlock on their milestone", () => {
  const cake: Unlockable = { id: "anniversary_cake", label: "Cake", metric: "milestone", threshold: 1, milestone: "together" };
  const ms: MilestoneDay[] = [{ id: "together", label: "Back together", date: "2026-12-03", reached: true }];
  assert.equal(isUnlocked(cake, { hours: 0, likes: 0, days: 0 }, ms), true);
  assert.equal(isUnlocked(cake, { hours: 0, likes: 0, days: 0 }, [{ ...ms[0], reached: false }]), false);
  assert.equal(progressOf(cake, { hours: 0, likes: 0, days: 0 }, []), 0);
  assert.deepEqual([...unlockedIds({ hours: 0, likes: 0, days: 0 }, [cake], ms)], ["anniversary_cake"]);
  assert.equal(milestoneToday(ms, new Date(2026, 11, 3, 20, 0))?.id, "together");
  assert.equal(milestoneToday(ms, new Date(2026, 11, 4, 9, 0)), null);
});

test("holidays follow their dates, across the new year too", () => {
  const h = { start: "12-20", end: "01-02", decorations: ["tree", "balloons"] };
  assert.equal(inHoliday(h, new Date(2026, 11, 31)), true);
  assert.equal(inHoliday(h, new Date(2027, 0, 2)), true);
  assert.equal(inHoliday(h, new Date(2027, 0, 3)), false);
  assert.deepEqual(holidayDecorations([h, { start: "12-31", end: "12-31", decorations: ["tree", "lanterns"] }], new Date(2026, 11, 31)), ["tree", "balloons", "lanterns"]);
});

test("weekend mornings get lazy light", () => {
  assert.equal(weekendMorning(new Date(2026, 10, 20, 9, 0)), 1); // Friday
  assert.equal(weekendMorning(new Date(2026, 10, 20, 14, 0)), 0);
  assert.equal(weekendMorning(new Date(2026, 10, 22, 9, 0)), 0); // Sunday
  assert.ok(weekendMorning(new Date(2026, 10, 21, 6, 50)) > 0); // Saturday, fading in
});

test("avatar looks parse and recolor", () => {
  assert.equal(parseLook(null), null);
  assert.equal(parseLook({ style: "robot" }), null);
  const look = parseLook({ style: "bob", hair: "#2b2833", skin: "#7a4a32", outfit: "#4985cc", glasses: true })!;
  assert.equal(look.glasses, true);
  assert.equal(lookOf("u1", null).style === "amelia" || lookOf("u1", null).style === "alex", true);
  assert.equal(recolor("bob", look, "#5d585f", 12), "#2b2833");
  const hi = recolor("bob", look, "#716b6e", 11)!;
  assert.ok(toHsl(hi)[2] > toHsl("#2b2833")[2]);
  assert.equal(recolor("bob", look, "#565972", 26), "#4985cc");
  assert.equal(recolor("bob", look, "#565972", 12), null);
  assert.equal(shift("#ffcbb0", "#ffcbb0", "#7a4a32"), "#7a4a32");
});
