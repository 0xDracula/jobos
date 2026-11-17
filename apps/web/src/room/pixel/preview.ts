import { DRINKS, FILMS, FLOWERS, FOODS, PLACES, ARTISTS } from "../favorites";
import * as D from "./decor";
import { RecordPlayer } from "./record";
import * as P from "./sprites";

export function spriteSheet(scale = 4): HTMLCanvasElement {
  const groups: [string, HTMLCanvasElement[]][] = [];
  const k = P.kittenFrames();
  groups.push(["kitten", Object.values(k)]);
  groups.push(["window", [P.curtainWindow()]]);
  const rp = new RecordPlayer();
  groups.push(["record", [0, 0.3, 0.6].map((s, i) => {
    const c = P.canvas(24, 14);
    c.getContext("2d")!.drawImage(rp.frame(0.2 * (i + 1), s, i ? 1 : 0, i === 2 ? 1 : 0, "#e88fa3", false), 0, 0);
    return c;
  })]);
  groups.push(["flowers", ["default" as const, ...FLOWERS].map((f) => D.flowerBunch(f))]);
  groups.push(["places", PLACES.map((p) => D.placePoster(p))]);
  groups.push(["films", FILMS.map((f) => D.filmPoster(f))]);
  groups.push(["artists", ARTISTS.map((a) => D.artistPoster(a))]);
  groups.push(["food", ["default" as const, ...FOODS].map((f) => D.snackSprite(f))]);
  groups.push(["drinks", DRINKS.map((d) => D.drinkTray(d))]);
  groups.push(["desk", [D.cassetteTray(), D.wrappedCassette("#4985cc"), D.tinCan(), D.pinnedRecord(), D.cushion("#e88fa3"), P.breakfastTray()]]);
  groups.push(["gift", [D.wallCalendar({ days: 16, surprise: true, date: 17 }), D.wallCalendar({ days: 128, surprise: false, date: 17 }), D.wallCalendar({ days: 0, surprise: false, date: 17 }), D.wallCalendar({ days: null, surprise: false, date: 17 }), D.floorGlobe(), D.storyBook(), D.deskLetters(0), D.deskLetters(2), D.stool(), D.noteJar(3, false), D.noteJar(1, true), D.noteJar(0, false)]]);
  groups.push(["milestones", [D.anniversaryCake(), D.starLantern(), D.roseBouquet(), D.polaroid(0), D.polaroid(1), D.banner(), D.balloons()]]);
  groups.push(["holidays", [D.lantern(), D.crescent(), D.holidayTree(), D.HEART_SMALL("#e0475a")]]);
  const pad = 4;
  const rowH = groups.map(([, list]) => Math.max(...list.map((c) => c.height)) + pad);
  const width = Math.max(...groups.map(([, list]) => list.reduce((w, c) => w + c.width + pad, 60)));
  const out = P.canvas(width * scale, rowH.reduce((a, b) => a + b, 0) * scale);
  const g = out.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.fillStyle = "#8c8aa8";
  g.fillRect(0, 0, out.width, out.height);
  let y = 0;
  groups.forEach(([name, list], i) => {
    g.fillStyle = "#ffffff";
    g.font = `${scale * 3}px sans-serif`;
    g.fillText(name, 2, (y + 6) * scale);
    let x = 60;
    for (const c of list) {
      g.drawImage(c, x * scale, y * scale, c.width * scale, c.height * scale);
      x += c.width + pad;
    }
    y += rowH[i];
  });
  return out;
}
