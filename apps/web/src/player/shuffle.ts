export function shuffleInPlace<T>(items: T[], random: () => number = Math.random): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function spreadOrder<T>(items: T[], artistOf: (item: T) => string, random: () => number): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = artistOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  const placed: { item: T; pos: number }[] = [];
  for (const group of groups.values()) {
    shuffleInPlace(group, random);
    const n = group.length;
    const offset = random() / n;
    group.forEach((item, i) => {
      const jitter = (random() - 0.5) * (0.2 / n);
      placed.push({ item, pos: offset + i / n + jitter });
    });
  }
  placed.sort((a, b) => a.pos - b.pos);
  return placed.map((p) => p.item);
}

export function spreadShuffle<T>(
  items: T[],
  artistOf: (item: T) => string,
  first?: T,
  random: () => number = Math.random,
): T[] {
  const remaining = spreadOrder(items, artistOf, random);
  const keys = remaining.map(artistOf);
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);

  const out: T[] = first === undefined ? [] : [first];
  let last = first === undefined ? null : artistOf(first);
  while (remaining.length) {
    let top: string | null = null;
    let topCount = 0;
    let secondCount = 0;
    for (const [k, c] of counts) {
      if (c > topCount) {
        secondCount = topCount;
        top = k;
        topCount = c;
      } else if (c > secondCount) {
        secondCount = c;
      }
    }
    const rest = remaining.length - 1;
    const separable = (a: string) =>
      counts.get(a)! - 1 <= Math.floor(rest / 2) && (a === top ? secondCount : topCount) <= Math.ceil(rest / 2);

    let pick = keys.findIndex((k) => k !== last && separable(k));
    if (pick < 0) {
      for (let i = 0; i < keys.length; i++) {
        if (keys[i] !== last && (pick < 0 || counts.get(keys[i])! > counts.get(keys[pick])!)) pick = i;
      }
    }
    if (pick < 0) pick = 0;

    const [item] = remaining.splice(pick, 1);
    const [key] = keys.splice(pick, 1);
    const left = counts.get(key)! - 1;
    if (left) counts.set(key, left);
    else counts.delete(key);
    out.push(item);
    last = key;
  }
  return out;
}
