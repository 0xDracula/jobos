import assert from "node:assert/strict";
import { test } from "node:test";

import { spreadShuffle } from "./shuffle.ts";

type Song = { id: number; artist: string };

const songs = (artists: Record<string, number>): Song[] => {
  let id = 0;
  return Object.entries(artists).flatMap(([artist, n]) => Array.from({ length: n }, () => ({ id: id++, artist })));
};

const repeats = (list: Song[]) => list.filter((s, i) => i > 0 && s.artist === list[i - 1].artist).length;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("keeps every song exactly once", () => {
  const list = songs({ a: 7, b: 3, c: 12, d: 1 });
  for (let seed = 0; seed < 50; seed++) {
    const out = spreadShuffle(list, (s) => s.artist, undefined, mulberry32(seed));
    assert.deepEqual(
      out.map((s) => s.id).sort((x, y) => x - y),
      list.map((s) => s.id),
    );
  }
});

test("never repeats an artist when it can be avoided", () => {
  const cases: Record<string, number>[] = [
    { a: 5, b: 5, c: 5, d: 5 },
    { a: 10, b: 9 },
    { a: 19, b: 3, c: 3, d: 3, e: 3, f: 3, g: 3 },
    { a: 1, b: 1 },
  ];
  for (const artists of cases) {
    const list = songs(artists);
    for (let seed = 0; seed < 200; seed++) {
      const out = spreadShuffle(list, (s) => s.artist, undefined, mulberry32(seed));
      assert.equal(repeats(out), 0, `seed ${seed}, ${JSON.stringify(artists)}: ${out.map((s) => s.artist).join("")}`);
    }
  }
});

test("keeps repeats to the unavoidable minimum", () => {
  const list = songs({ a: 6, b: 1 });
  for (let seed = 0; seed < 100; seed++) {
    const out = spreadShuffle(list, (s) => s.artist, undefined, mulberry32(seed));
    assert.equal(repeats(out), 4);
  }
});

test("starts with the given first song and spreads after it", () => {
  const list = songs({ a: 4, b: 4, c: 4 });
  const [first, ...rest] = list;
  for (let seed = 0; seed < 200; seed++) {
    const out = spreadShuffle(rest, (s) => s.artist, first, mulberry32(seed));
    assert.equal(out[0], first);
    assert.equal(out.length, list.length);
    assert.equal(repeats(out), 0, `seed ${seed}: ${out.map((s) => s.artist).join("")}`);
  }
});

test("orders differ between runs", () => {
  const list = songs({ a: 3, b: 3, c: 3, d: 3 });
  const orders = new Set<string>();
  for (let seed = 0; seed < 20; seed++) {
    orders.add(spreadShuffle(list, (s) => s.artist, undefined, mulberry32(seed)).map((s) => s.id).join(","));
  }
  assert.ok(orders.size > 15);
});
