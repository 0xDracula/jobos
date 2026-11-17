import { O, type Art } from "../art";

export const DATE_ART = {
  calendar: {
    rows: ["...o....o...", ".oooooooooo.", ".orrrrrrrro.", ".orrrrrrrro.", ".oooooooooo.", ".owwwwwwwwo.", ".owdwdwdwwo.", ".owwwwwwwwo.", ".owdwdwhhwo.", ".owwwwwhhwo.", ".oooooooooo.", "............"],
    pal: { o: O, r: "#e0475a", w: "#fff4e8", d: "#b9aee0", h: "#e88fa3" },
  },
  present: {
    rows: ["..oo....oo..", ".oyyo..oyyo.", ".oyyyooyyyo.", "..oooyyooo..", "oooooyyooooo", "oppppyyppppo", "oooooyyooooo", ".oqqqyyqqqo.", ".oqqqyyqqqo.", ".oqqqyyqqqo.", ".oqqqyyqqqo.", ".oooooooooo."],
    pal: { o: O, y: "#ffd98a", p: "#f2a7b8", q: "#e88fa3" },
  },
  cake: {
    rows: [".....f......", ".....c......", ".....c......", "..oooooooo..", ".owwwwwwwwo.", ".owpwwpwwpo.", ".oppppppppo.", ".oppppppppo.", ".owwwwwwwwo.", ".obbbbbbbbo.", "oooooooooooo", "............"],
    pal: { o: O, f: "#ffb84d", c: "#c9b8f0", w: "#fff4e8", p: "#f2a7b8", b: "#b98a5e" },
  },
  rings: {
    rows: ["............", "...cc.......", "..cccc......", "...cc.......", "..yyyy......", ".y....yyyy..", ".y...yy...y.", ".y...yy...y.", ".y...yy...y.", "..yyyy....y.", "......yyyy..", "............"],
    pal: { c: "#8fc8ec", y: "#d99a3e" },
  },
  hourglass: {
    rows: [".bbbbbbbbbb.", "..oggggggo..", "..oyyyyyyo..", "...oyyyyo...", "....oyyo....", ".....oo.....", "....ogyo....", "...oggygo...", "..ogyyyygo..", "..oyyyyyyo..", ".bbbbbbbbbb.", "............"],
    pal: { o: O, b: "#9b6a4a", g: "#e7eefb", y: "#ffd98a" },
  },
  flag: {
    rows: ["..o.........", "..obbbbb....", "..obbbbbbb..", "..obbbbbbbb.", "..obbbbbb...", "..obbb......", "..o.........", "..o.........", "..o.........", "..o.........", ".ooo........", "............"],
    pal: { o: O, b: "#5d7fb8" },
  },
  seal: {
    rows: ["............", "............", "oooooooooooo", "oowwwwwwwwoo", "owowwwwwwowo", "owwowwwwowwo", "owwwoRRowwwo", "owwwwRRwwwwo", "owwwwwwwwwwo", "owwwwwwwwwwo", "oooooooooooo", "............"],
    pal: { o: O, w: "#fff4e8", R: "#c8384a" },
  },
  lantern: {
    rows: [".....oo.....", "....oyyo....", "...oooooo...", "..oyhhhhyo..", "..ohyyyyho..", "..oyhhhhyo..", "..ohyyyyho..", "...oooooo...", "....oyyo....", ".....oo.....", "............", "............"],
    pal: { o: O, y: "#e3a857", h: "#ffe6a7" },
  },
  stats: {
    rows: ["............", "........ooo.", "........oco.", "....ooo.oco.", "....obo.oco.", "....obo.oco.", "ooo.obo.oco.", "oao.obo.oco.", "oao.obo.oco.", "oao.obo.oco.", "oooooooooooo", "............"],
    pal: { o: O, a: "#c9b8f0", b: "#e88fa3", c: "#ffd98a" },
  },
  recap: {
    rows: ["...oooooooo.", ".oooooooolo.", ".oppppppolo.", ".opppyppolo.", ".oppyyypolo.", ".opppyppolo.", ".oppppppolo.", ".owwwwwwolo.", ".oppppppolo.", ".owwwwppolo.", ".oppppppooo.", ".oooooooo..."],
    pal: { o: O, p: "#c9b8f0", l: "#f2a7b8", w: "#fff4e8", y: "#ffd98a" },
  },
} satisfies Record<string, Art>;
