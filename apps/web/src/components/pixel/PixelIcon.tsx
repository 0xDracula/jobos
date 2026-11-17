import { memo } from "react";

type Art = { rows: string[]; pal: Record<string, string> };

const O = "#2e2c48"; // outline, the room's sprite ink

const ART = {
  record: {
    rows: ["....oooo....", "..oo####oo..", ".o###--###o.", ".o#-####-#o.", "o##-#pp#-##o", "o###pwwp###o", "o###pwwp###o", "o##-#pp#-##o", ".o#-####-#o.", ".o###--###o.", "..oo####oo..", "....oooo...."],
    pal: { o: O, "#": "#1b1a2b", "-": "#3f3d5c", p: "#e88fa3", w: "#fff4e8" },
  },
  notes: {
    rows: ["oooooooooo..", "owwwwwwwwo..", "owllllllwo..", "owwwwwwwwo..", "owlllllwwo..", "owwwwwwwwo.p", "owllllllwopp", "owwwwwwwpp..", "owlllllpp...", "owwwwwwpo...", "oooooooo....", "............"],
    pal: { o: O, w: "#fff4e8", l: "#b9aee0", p: "#e88fa3" },
  },
  scrap: {
    rows: ["....tttt....", "..oottttoo..", "..owwwwwwo..", "..owrrrrwo..", "..owwwwwwo..", "..owrrrwwo..", "..owwwwwwo..", "..owrrrrwo..", "..owwwwwwo..", "..owrrwwwo..", "..oooooooo..", "............"],
    pal: { o: O, w: "#fff4e8", r: "#a8445e", t: "#e8cf98" },
  },
  mic: {
    rows: ["....oooo....", "...oggggo...", "...ogwwgo...", "...oggggo...", "...oggggo...", "...oggggo...", ".o..oooo..o.", ".o........o.", "..o......o..", "...oooooo...", ".....oo.....", "...oooooo..."],
    pal: { o: O, g: "#a99fd0", w: "#fff4e8" },
  },
  cassette: {
    rows: ["............", "oooooooooooo", "oppppppppppo", "opwwwwwwwwpo", "oppppppppppo", "opokkooookpo", "opokkooookpo", "oppppppppppo", "opp.oooo.ppo", "oooooooooooo", "............", "............"],
    pal: { o: O, p: "#d0705f", w: "#fff4e8", k: "#1b1a2b" },
  },
  flower: {
    rows: ["...pp.......", "..pyyp..pp..", "...pp..pyyp.", "....g...pp..", "..pp.g.g....", ".pyyp.gg....", "..pp..g.....", "......g.....", "...oooooo...", "...obbbbo...", "...obbbbo...", "....oooo...."],
    pal: { o: O, p: "#f2a7b8", y: "#ffd98a", g: "#6f9a7a", b: "#9b6a4a" },
  },
  star: {
    rows: [".....y......", ".....y......", "....yyy.....", "....yyy.....", "yyyyyyyyyyy.", ".yyyyyyyyy..", "..yyyyyyy...", "...yyyyy....", "...yy.yy....", "..yy...yy...", ".y.......y..", "............"],
    pal: { y: "#ffd98a" },
  },
  window: {
    rows: ["oooooooooooo", "osssssosssso", "osssysossyso", "osssssosssso", "osssssosssso", "oooooooooooo", "occcccocccco", "occlccoclcco", "occcccocccco", "occcccocccco", "oooooooooooo", "............"],
    pal: { o: O, s: "#5b78c9", y: "#ffe6a7", c: "#8fa6e0", l: "#ffcf7a" },
  },
  headphones: {
    rows: ["...oooooo...", "..o......o..", ".o........o.", ".o........o.", "o..........o", "o..........o", "pp........pp", "ppp......ppp", "ppp......ppp", "ppp......ppp", ".pp......pp.", "............"],
    pal: { o: O, p: "#e88fa3" },
  },
  moon: {
    rows: ["....yyyy....", "..yyyyy.....", ".yyyyy......", ".yyyy.......", "yyyy........", "yyyy........", "yyyy........", "yyyyy.....y.", ".yyyyy...yy.", ".yyyyyyyyyy.", "..yyyyyyyy..", "....yyyy...."],
    pal: { y: "#ffe6a7" },
  },
  sun: {
    rows: [".....r......", "..r..r..r...", "...r...r....", "....yyy.....", "...yyyyy....", "rr.yyyyy.rr.", "...yyyyy....", "....yyy.....", "...r...r....", "..r..r..r...", ".....r......", "............"],
    pal: { y: "#ffd25e", r: "#ffb84d" },
  },
} satisfies Record<string, Art>;

export type PixelIconName = keyof typeof ART;

function rects({ rows, pal }: Art) {
  const out: { x: number; y: number; w: number; c: string }[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = pal[row[x]];
      if (!c) {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < row.length && row[x + w] === row[x]) w++; // one rect per run
      out.push({ x, y, w, c });
      x += w;
    }
  });
  return out;
}

const CACHE = new Map<string, ReturnType<typeof rects>>();

export const PixelIcon = memo(function PixelIcon({ name, size = 40, className }: { name: PixelIconName; size?: number; className?: string }) {
  let r = CACHE.get(name);
  if (!r) CACHE.set(name, (r = rects(ART[name])));
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden className={className}>
      {r.map((p, i) => (
        <rect key={i} x={p.x} y={p.y} width={p.w} height={1} fill={p.c} />
      ))}
    </svg>
  );
});
