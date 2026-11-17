#!/usr/bin/env python3

from __future__ import annotations

import math
import random
from collections.abc import Callable
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parent.parent / "services/api/internal/httpapi/placeholders/memories"
SCALE = 4

INK = "#2e2c48"
NAVY_DEEP = "#15163b"
NAVY = "#1c1a3d"
NAVY_MID = "#24224f"
NAVY_LIGHT = "#2e2b61"
LIT = "#ffcf7a"
LIT_PALE = "#ffe3a6"
WHITE = "#ffffff"
BUTTER = "#ffe6a7"
LAVENDER = "#c9b8f0"
SKY_TOP = "#9fcbee"
SKY_MID = "#cfe3f3"
PEACH = "#f9dccb"
FAR = "#d6d0ea"
NEAR = "#c3bbdc"
ROSE = "#e88fa3"
DEEP_ROSE = "#a8445e"
BLUSH = "#f7c6d0"
SAGE = "#c8dcc0"
PLANT = "#6f9a7a"
WOOD = "#b98a5e"
WOOD_DARK = "#8d6644"
CREAM = "#fff4e8"
SUNSET_PINK = "#f2a7b8"
ORANGE = "#ffb84d"
GOLD = "#ffd25e"
PLUM = "#5b3a6b"
TEA = "#b3472a"
TEA_TOP = "#d9784a"
GLASS = "#e9e6f5"
BRASS = "#dcae5e"
LEAF_DARK = "#4f7a62"


class Rand:
    def __init__(self, seed: int):
        self.r = random.Random(seed)

    def random(self) -> float:
        return self.r.random()

    def randrange(self, lo: int, hi: int) -> int:
        return lo + int(self.r.random() * (hi - lo))

    def randint(self, lo: int, hi: int) -> int:
        return lo + int(self.r.random() * (hi - lo + 1))

    def choice(self, seq):
        return seq[int(self.r.random() * len(seq))]

    def gauss(self, mu: float, sigma: float) -> float:
        u1, u2 = 1.0 - self.r.random(), self.r.random()
        return mu + sigma * math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)


def rgb(c: str) -> tuple[int, int, int]:
    return int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16)


def mix(a: str, b: str, t: float) -> str:
    (r1, g1, b1), (r2, g2, b2) = rgb(a), rgb(b)
    return "#%02x%02x%02x" % (round(r1 + (r2 - r1) * t), round(g1 + (g2 - g1) * t), round(b1 + (b2 - b1) * t))


def dither(x: int, y: int, level: int) -> bool:
    if level <= 0:
        return False
    if level >= 4:
        return True
    if level == 2:
        return (x + y) % 2 == 0
    q = (x + 2 * (y % 2)) % 4
    return q == 0 if level == 1 else q != 2


class Art:
    def __init__(self, w: int, h: int, fill: str):
        self.w, self.h = w, h
        self.p = [fill] * (w * h)

    def get(self, x: int, y: int) -> str | None:
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.p[y * self.w + x]
        return None

    def dot(self, x: int, y: int, c: str) -> None:
        if 0 <= x < self.w and 0 <= y < self.h:
            self.p[y * self.w + x] = c

    def rect(self, x: int, y: int, w: int, h: int, c: str) -> None:
        for yy in range(max(y, 0), min(y + h, self.h)):
            row = yy * self.w
            for xx in range(max(x, 0), min(x + w, self.w)):
                self.p[row + xx] = c

    def where(self, test: Callable[[int, int], bool], c, box=None) -> None:
        x0, y0, x1, y1 = box or (0, 0, self.w, self.h)
        for y in range(max(y0, 0), min(y1, self.h)):
            for x in range(max(x0, 0), min(x1, self.w)):
                if test(x, y):
                    self.p[y * self.w + x] = c(x, y) if callable(c) else c

    def recolour(self, mapping: dict[str, str], box=None) -> None:
        x0, y0, x1, y1 = box or (0, 0, self.w, self.h)
        for y in range(max(y0, 0), min(y1, self.h)):
            for x in range(max(x0, 0), min(x1, self.w)):
                i = y * self.w + x
                self.p[i] = mapping.get(self.p[i], self.p[i])

    def disc(self, cx: int, cy: int, r: int, c: str) -> None:
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if dx * dx + dy * dy <= r * r + r:
                    self.dot(cx + dx, cy + dy, c)

    def ellipse(self, cx: float, cy: float, rx: float, ry: float, c: str, y_max: float | None = None) -> None:
        for y in range(math.floor(cy - ry), math.ceil(cy + ry) + 1):
            if y_max is not None and y >= y_max:
                break
            for x in range(math.floor(cx - rx), math.ceil(cx + rx) + 1):
                dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
                if dx * dx + dy * dy <= 1:
                    self.dot(x, y, c)

    def poly(self, pts: list[tuple[float, float]], c: str) -> None:
        ys = [p[1] for p in pts]
        for y in range(max(0, math.floor(min(ys))), min(self.h, math.ceil(max(ys)) + 1)):
            yc = y + 0.5
            xs = []
            for i, (x0, y0) in enumerate(pts):
                x1, y1 = pts[(i + 1) % len(pts)]
                if (y0 <= yc < y1) or (y1 <= yc < y0):
                    xs.append(x0 + (yc - y0) * (x1 - x0) / (y1 - y0))
            xs.sort()
            for j in range(0, len(xs) - 1, 2):
                for x in range(math.ceil(xs[j] - 0.5), math.ceil(xs[j + 1] - 0.5)):
                    self.dot(x, y, c)

    def line(self, x0: int, y0: int, x1: int, y1: int, c: str) -> None:
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err = dx + dy
        while True:
            self.dot(x0, y0, c)
            if x0 == x1 and y0 == y1:
                return
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def wire(self, x0: int, y0: int, x1: int, y1: int, sag: float, c: str) -> list[tuple[int, int]]:
        pts: list[tuple[int, int]] = []
        prev = None
        for x in range(x0, x1 + 1):
            t = (x - x0) / (x1 - x0)
            y = round(y0 + (y1 - y0) * t + 4 * sag * t * (1 - t))
            if prev is not None and abs(y - prev) > 1:
                step = 1 if y > prev else -1
                for yy in range(prev + step, y, step):
                    self.dot(x, yy, c)
            self.dot(x, y, c)
            pts.append((x, y))
            prev = y
        return pts

    def sprite(self, x: int, y: int, rows: list[str], colours: dict[str, str]) -> None:
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch in colours:
                    self.dot(x + i, y + j, colours[ch])

    def bands(self, y: int, stops: list[tuple[str, int]], x0: int = 0, x1: int | None = None, edge: int = 3) -> int:
        x1 = self.w if x1 is None else x1
        prev = None
        for colour, rows in stops:
            for r in range(rows):
                level = round((r + 1) * 4 / (edge + 1)) if prev is not None and r < edge else 4
                for x in range(x0, x1):
                    self.dot(x, y + r, colour if dither(x, y + r, level) else prev)
            prev = colour
            y += rows
        return y

    def light(self, cx: float, cy: float, r: float, colour: str, t: float, steps: int = 2) -> None:
        cache: dict[tuple[str, int], str] = {}
        for y in range(max(0, math.floor(cy - r)), min(self.h, math.ceil(cy + r) + 1)):
            for x in range(max(0, math.floor(cx - r)), min(self.w, math.ceil(cx + r) + 1)):
                d = math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r
                if d >= 1:
                    continue
                k = steps - int(d * steps)
                if (d * steps) % 1 > 0.7 and (x + y) % 2:
                    k -= 1
                if k <= 0:
                    continue
                i = y * self.w + x
                key = (self.p[i], k)
                if key not in cache:
                    cache[key] = mix(self.p[i], colour, t * k / steps)
                self.p[i] = cache[key]



def stars(a: Art, rng: Rand, box, n: int, colours=(WHITE, BUTTER, LAVENDER), big: int = 0) -> None:
    x0, y0, x1, y1 = box
    for i in range(n + big):
        x, y = rng.randrange(x0 + 1, x1 - 1), rng.randrange(y0 + 1, y1 - 1)
        c = rng.choice(colours)
        if i < n:
            a.dot(x, y, c)
        else:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                a.dot(x + dx, y + dy, c)
            a.dot(x, y, WHITE)


def cloud(a: Art, x: int, y: int, w: int, body: str = WHITE, shade: str = SKY_MID) -> None:
    pts: set[tuple[int, int]] = set()

    def blob(cx: float, cy: float, rx: float, ry: float) -> None:
        for py in range(math.floor(cy - ry), y + 1):
            for px in range(math.floor(cx - rx), math.ceil(cx + rx) + 1):
                if ((px + 0.5 - cx) / rx) ** 2 + ((py + 0.5 - cy) / ry) ** 2 <= 1:
                    pts.add((px, py))

    blob(x + w * 0.5, y + 1, w * 0.5, w * 0.17)
    blob(x + w * 0.34, y - w * 0.04, w * 0.2, w * 0.2)
    blob(x + w * 0.6, y - w * 0.07, w * 0.16, w * 0.22)
    for px, py in sorted(pts):
        a.dot(px, py, shade if py == y or (px, py + 1) not in pts else body)


def skyline(a: Art, rng: Rand, x0: int, x1: int, base: int, hs: tuple[int, int], ws: tuple[int, int], c: str):
    out = []
    x = x0
    while x < x1:
        w, h = rng.randint(*ws), rng.randint(*hs)
        a.rect(x, base - h, w, h, c)
        out.append((x, w, base - h))
        x += w
    return out


def minaret(a: Art, x: int, base: int, h: int, c: str) -> None:
    top = base - h
    hw = 2 if h >= 22 else 1
    b1 = base - round(h * 0.55)
    b2 = base - round(h * 0.8)
    a.rect(x - hw, b1, 2 * hw + 1, base - b1, c)
    a.rect(x - hw - 1, b1, 2 * hw + 3, 1, c)
    a.rect(x - 1, b2, 3, b1 - b2, c)
    a.rect(x - 2, b2, 5, 1, c)
    a.rect(x - (1 if hw == 2 else 0), top + 4, 1 + (2 if hw == 2 else 0), b2 - top - 4, c)
    a.rect(x - 1, top + 2, 3, 2, c)
    a.rect(x, top, 1, 2, c)


def dome(a: Art, cx: int, base: int, r: int, c: str, drum: int = 6) -> None:
    for dy in range(-r, 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy <= r * r + r:
                a.dot(cx + dx, base + dy, c)
    a.rect(cx - r - 1, base + 1, 2 * r + 3, drum, c)
    a.rect(cx, base - r - 2, 1, 2, c)


def palm(a: Art, x: int, base: int, h: int, c: str, lean: float = 0.15) -> None:
    tx = x + lean * h
    for i in range(h + 1):
        t = i / h
        px = round(x + (tx - x) * t * t)
        a.dot(px, base - i, c)
        if i < h * 0.5:
            a.dot(px + 1, base - i, c)
    cx, cy = round(tx), base - h
    length = max(6, round(h * 0.4))
    for ang, droop in ((-150, 0.55), (-118, 0.3), (-62, 0.3), (-30, 0.55), (180, 1.0), (0, 1.0), (165, 1.6), (15, 1.6)):
        rad = math.radians(ang)
        for s in range(1, length + 1):
            f = s / length
            px = round(cx + math.cos(rad) * s)
            py = round(cy + math.sin(rad) * s + droop * f * f * length * 0.7)
            a.dot(px, py, c)
            if f < 0.7:
                a.dot(px, py + 1, c)
            if 0.3 < f < 0.95 and s % 2 == 0:
                a.dot(px, py + 2, c)
    a.rect(cx - 1, cy - 1, 3, 3, c)


def bird(a: Art, x: int, y: int, c: str) -> None:
    a.sprite(x, y, ["oo.oo", "..o.."], {"o": c})


def dish(a: Art, x: int, y: int, r: int, c: str, pole: int = 4) -> None:
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy <= r * r + r and dx - dy <= 0:
                a.dot(x + dx, y + dy, c)
    a.line(x, y, x + r, y - r, c)
    a.rect(x + r, y - r - 1, 2, 2, c)
    a.rect(x - 1, y + r, 1, pole, c)


def leaf(a: Art, x: float, y: float, ang: float, length: float, width: float, body: str, rib: str) -> None:
    ux, uy = math.cos(math.radians(ang)), math.sin(math.radians(ang))
    nx, ny = -uy, ux
    tip = (x + ux * length, y + uy * length)
    mid = (x + ux * length * 0.45, y + uy * length * 0.45)
    a.poly([(x, y), (mid[0] + nx * width, mid[1] + ny * width), tip, (mid[0] - nx * width, mid[1] - ny * width)], body)
    a.line(round(x), round(y), round(x + ux * length * 0.7), round(y + uy * length * 0.7), rib)


def dashes(a: Art, rng: Rand, x0: int, x1: int, y: int, c: str, run=(2, 5), gap=(1, 2)) -> None:
    x = x0
    while x < x1:
        n = rng.randint(*run)
        a.rect(x, y, min(n, x1 - x), 1, c)
        x += n + rng.randint(*gap)


def glints(a: Art, rng: Rand, box, n: int, lighter: dict[str, str], run=(2, 5)) -> None:
    x0, y0, x1, y1 = box
    for _ in range(n):
        x, y = rng.randrange(x0, x1), rng.randrange(y0, y1)
        c = lighter.get(a.get(x, y) or "")
        if c:
            a.rect(x, y, rng.randint(*run), 1, c)


def tea_glass(a: Art, x: int, bottom: int, w: int = 5, h: int = 7) -> None:
    top = bottom - h + 1
    for j in range(h):
        inset = 1 if j >= h * 0.6 else 0
        y = top + j
        a.rect(x + inset, y, w - 2 * inset, 1, GLASS)
        if 1 <= j < h - 1:
            a.rect(x + inset + 1, y, w - 2 * inset - 2, 1, TEA_TOP if j == 1 else TEA)
    a.dot(x + 1, top + 2, WHITE)


def fanous(a: Art, x: int, y: int, size: str, glass: str, side: str) -> None:
    rows = {
        "l": [
            ".....k.....",
            "....k.k....",
            ".....k.....",
            "....kbk....",
            "...kbbbk...",
            "..kbgggbk..",
            ".kbgggggbk.",
            "kkkkkkkkkkk",
            "kssbcccbssk",
            "kssbcwcbssk",
            "kssbcccbssk",
            "kssbcccbssk",
            "kssbcccbssk",
            "kkkkkkkkkkk",
            ".kbgggggbk.",
            "..kbgggbk..",
            "...kbgbk...",
            "....kbk....",
            ".....k.....",
        ],
        "m": [
            "...k...",
            "..k.k..",
            "...k...",
            "..kbk..",
            ".kbgbk.",
            "kkkkkkk",
            "ksbcbsk",
            "ksbwbsk",
            "ksbcbsk",
            "kkkkkkk",
            ".kbgbk.",
            "..kbk..",
            "...k...",
        ],
        "s": [
            "..k..",
            ".kbk.",
            "kkkkk",
            "kscsk",
            "kscsk",
            "kkkkk",
            ".kgk.",
            "..k..",
        ],
    }[size]
    w = len(rows[0])
    a.sprite(x - w // 2, y, rows, {"k": INK, "b": BRASS, "g": LIT_PALE, "c": glass, "s": side, "w": WHITE})



def nile_felucca() -> Art:
    a = Art(160, 120, PLUM)
    rng = Rand(101)
    horizon = 68
    a.bands(0, [(PLUM, 12), (DEEP_ROSE, 12), (ROSE, 13), (SUNSET_PINK, 12), (ORANGE, 11), (GOLD, 8)])
    sun_x = 122
    a.disc(sun_x, 61, 10, LIT_PALE)
    a.disc(sun_x, 61, 8, CREAM)
    for x, y in ((30, 22), (39, 17), (46, 24)):
        bird(a, x, y, PLUM)
    far = mix(PLUM, ROSE, 0.35)
    skyline(a, rng, 0, 160, horizon, (1, 5), (4, 9), far)
    minaret(a, 20, horizon, 14, far)
    dome(a, 42, horizon - 3, 4, far)
    minaret(a, 100, horizon, 12, far)
    dome(a, 146, horizon - 2, 3, far)
    water = [mix(ORANGE, ROSE, 0.5), ROSE, mix(ROSE, DEEP_ROSE, 0.5), mix(DEEP_ROSE, PLUM, 0.5), PLUM]
    a.bands(horizon, list(zip(water, (4, 9, 12, 13, 14))), edge=2)
    a.rect(0, horizon, 160, 1, mix(PLUM, ROSE, 0.15))
    glints(a, rng, (0, horizon + 3, 160, 120), 60, {water[1]: SUNSET_PINK, water[2]: ROSE, water[3]: water[2], water[4]: water[3]})
    for i, y in enumerate(range(horizon + 2, 106, 2)):
        half = max(1, 9 - i // 2 + rng.randint(-1, 1))
        colour = LIT_PALE if i < 3 else GOLD if i < 9 else ORANGE
        dashes(a, rng, sun_x - half + rng.randint(-1, 1), sun_x + half, y, colour)

    bx, wl = 64, 97
    hull = mix(PLUM, INK, 0.5)
    for y, x0, x1 in ((wl + 2, bx + 1, bx + 31), (wl + 4, bx + 5, bx + 27), (wl + 6, bx + 9, bx + 23)):
        dashes(a, rng, x0, x1, y, hull, run=(3, 7))
    for i, y in enumerate(range(wl + 8, wl + 21, 2)):
        dashes(a, rng, bx + 8 + i * 3, bx + 29, y, mix(CREAM, ROSE, 0.55), run=(2, 4))
    a.poly([(bx + 4, wl - 5), (bx + 31, wl - 52), (bx + 29, wl - 5)], CREAM)
    a.poly([(bx + 25, wl - 5), (bx + 31, wl - 52), (bx + 29, wl - 5)], BLUSH)
    seam = mix(CREAM, BLUSH, 0.5)
    for y in range(wl - 45, wl - 5, 8):
        a.recolour({CREAM: seam}, (bx, y, bx + 32, y + 1))
    a.line(bx + 12, wl - 3, bx + 12, wl - 20, INK)
    a.line(bx + 2, wl - 2, bx + 32, wl - 54, INK)
    a.poly([(bx - 3, wl - 6), (bx + 2, wl - 3), (bx + 30, wl - 3), (bx + 34, wl - 6), (bx + 30, wl + 1), (bx + 3, wl + 1)], hull)
    a.rect(bx + 2, wl - 2, 28, 1, ROSE)

    bank = mix(PLUM, INK, 0.55)
    a.poly([(0, 90), (12, 88), (26, 91), (40, 98), (50, 108), (56, 120), (0, 120)], bank)
    palm(a, 8, 90, 44, bank, lean=0.18)
    palm(a, 24, 92, 32, bank, lean=-0.22)
    palm(a, 38, 99, 22, bank, lean=0.3)
    return a


def rooftop_lights() -> Art:
    a = Art(160, 120, NAVY_LIGHT)
    rng = Rand(102)
    dusk1, dusk2 = mix(NAVY_LIGHT, LAVENDER, 0.3), mix(NAVY_LIGHT, LAVENDER, 0.62)
    a.bands(0, [(NAVY_LIGHT, 12), (dusk1, 12), (dusk2, 12), (LAVENDER, 12), (BLUSH, 10), (PEACH, 12)])
    stars(a, rng, (0, 0, 160, 16), 12, (WHITE, BUTTER))
    far = mix(NAVY_LIGHT, LAVENDER, 0.45)
    skyline(a, rng, 0, 160, 72, (3, 12), (6, 14), far)
    minaret(a, 36, 72, 30, far)
    dome(a, 74, 63, 6, far, drum=10)
    minaret(a, 140, 72, 22, far)

    face = mix(NAVY_LIGHT, LAVENDER, 0.18)
    edge = mix(face, LAVENDER, 0.35)
    unlit = mix(face, NAVY_DEEP, 0.45)
    for x, w, top, roof in ((-2, 30, 58, "tank"), (28, 24, 66, "dish"), (52, 34, 56, "laundry"), (86, 30, 64, ""), (116, 46, 60, "dish")):
        a.rect(x, top, w, 82 - top, face)
        a.rect(x, top, w, 1, edge)
        for wy in range(top + 4, 78, 7):
            for wx in range(x + 4, x + w - 5, 8):
                a.rect(wx, wy, 3, 4, LIT if rng.random() < 0.45 else unlit)
        rx = x + 6
        if roof == "tank":
            a.rect(rx, top - 7, 10, 5, INK)
            a.rect(rx + 1, top - 6, 2, 3, NAVY_LIGHT)
            a.rect(rx + 1, top - 2, 1, 2, INK)
            a.rect(rx + 8, top - 2, 1, 2, INK)
        elif roof == "dish":
            a.ellipse(rx + 4, top - 4, 3.5, 2.5, NEAR)
            a.rect(rx + 4, top - 3, 1, 3, INK)
        elif roof == "laundry":
            a.rect(rx, top - 9, 1, 9, INK)
            a.rect(rx + 22, top - 9, 1, 9, INK)
            a.rect(rx, top - 9, 23, 1, INK)
            for i, c in enumerate((ROSE, CREAM, LAVENDER, SAGE)):
                a.rect(rx + 2 + i * 5, top - 8, 3, 4 + i % 2 * 2, c)

    a.rect(0, 80, 160, 2, "#f3e1d4")
    a.rect(0, 82, 160, 5, "#d8b4ab")
    a.rect(0, 87, 160, 1, "#b0868a")
    floor, joint = "#c99a8c", "#b7867c"
    a.rect(0, 88, 160, 32, floor)
    for y in (90, 93, 97, 102, 108, 115):
        a.rect(0, y, 160, 1, joint)
    for xb in range(-220, 400, 26):
        for y in range(88, 120):
            a.dot(round(80 + (xb - 80) * (y - 40) / 80), y, joint)

    tank, tank_light = mix(NAVY_LIGHT, NAVY_DEEP, 0.2), mix(NAVY_LIGHT, LAVENDER, 0.35)
    for lx in (128, 145):
        a.rect(lx, 60, 1, 34, INK)
    a.line(128, 66, 145, 82, INK)
    a.line(145, 66, 128, 82, INK)
    a.rect(126, 44, 22, 17, INK)
    a.rect(127, 45, 20, 15, tank)
    a.rect(129, 45, 3, 15, tank_light)
    a.rect(126, 42, 22, 2, INK)
    a.rect(133, 40, 8, 2, INK)

    for x0, y0, x1, y1, sag in ((-2, 4, 82, 10, 12), (82, 10, 162, 2, 10), (-2, 30, 127, 43, 10)):
        pts = a.wire(x0, y0, x1, y1, sag, INK)
        for k, (x, y) in enumerate(pts[3::7]):
            a.light(x + 1, y + 2.5, 4.5, LIT, 0.3)
            a.rect(x, y + 1, 2, 2, LIT if k % 3 else LIT_PALE)
            a.dot(x, y + 1, LIT_PALE)

    for x, y, w, body, light, shade in ((12, 97, 36, ROSE, BLUSH, DEEP_ROSE), (106, 99, 34, LAVENDER, "#e6dcfb", "#9686c8")):
        a.rect(x + 2, y, w - 4, 14, INK)
        a.rect(x + 1, y + 1, w - 2, 12, INK)
        a.rect(x, y + 2, w, 10, INK)
        a.rect(x + 2, y + 1, w - 4, 12, body)
        a.rect(x + 1, y + 2, w - 2, 10, body)
        a.rect(x + 3, y + 1, w - 6, 1, light)
        a.rect(x + 2, y + 2, w - 4, 2, light)
        a.rect(x + 1, y + 7, w - 2, 1, mix(body, shade, 0.5))
        a.rect(x + 1, y + 8, w - 2, 4, shade)
        a.rect(x + 2, y + 12, w - 4, 1, shade)
        a.rect(x + w // 2 - 1, y + 4, 2, 2, mix(body, shade, 0.5))
        for tx in (x - 1, x + w - 1):
            a.rect(tx, y + 10, 2, 2, BUTTER)
    a.ellipse(76, 108, 15, 4.5, INK)
    a.ellipse(76, 107.5, 14, 3.5, BRASS)
    a.ellipse(76, 107, 11, 2.5, mix(BRASS, LIT_PALE, 0.4))
    tea_glass(a, 68, 107, 5, 8)
    tea_glass(a, 79, 108, 5, 8)
    return a


def cafe_rain() -> Art:
    a = Art(120, 160, NAVY_LIGHT)
    rng = Rand(103)
    gx0, gy0, gx1, gy1 = 16, 18, 104, 100

    a.bands(0, [(NAVY_LIGHT, 22), (mix(NAVY_LIGHT, PLUM, 0.35), 20), (NAVY_MID, 62)])
    for x, w, top in ((10, 30, 34), (40, 26, 46), (66, 18, 30), (84, 26, 40)):
        a.rect(x, top, w, 70, NAVY_DEEP if x % 20 else NAVY)
        for wy in range(top + 4, 80, 8):
            for wx in range(x + 3, x + w - 4, 6):
                if rng.random() < 0.4:
                    a.rect(wx, wy, 3, 4, mix(LIT, NAVY, 0.3))
    a.rect(0, 84, 120, 20, NAVY_MID)
    for _ in range(16):
        x, y, r = rng.randrange(gx0, gx1), rng.randrange(80, 98), rng.randint(2, 4)
        c = rng.choice((mix(LIT, NAVY_MID, 0.3), mix(ROSE, NAVY_MID, 0.35), mix(LIT_PALE, NAVY_MID, 0.25), mix(LAVENDER, NAVY_MID, 0.45)))
        a.disc(x, y, r, c)
        a.disc(x, y, max(0, r - 2), mix(c, WHITE, 0.25))
    streak, drop = mix(NAVY_LIGHT, LAVENDER, 0.4), mix(LAVENDER, WHITE, 0.4)
    for _ in range(44):
        x, y, n = rng.randrange(gx0 + 1, gx1 - 1), rng.randrange(gy0, gy1 - 6), rng.randint(3, 9)
        for j in range(n):
            a.dot(x + (1 if j > n * 0.6 and x % 3 == 0 else 0), y + j, streak)
        a.dot(x + (1 if x % 3 == 0 else 0), y + n, drop)

    wall = mix(PLUM, WOOD_DARK, 0.7)
    a.where(lambda x, y: not (gx0 <= x < gx1 and gy0 <= y < gy1), wall)
    a.rect(0, 112, 120, 48, mix(wall, INK, 0.25))
    a.rect(0, 112, 120, 1, mix(wall, WOOD, 0.4))
    for x, y, w, h in ((12, 14, 96, 4), (12, 100, 96, 4), (12, 14, 4, 90), (104, 14, 4, 90), (58, 18, 4, 82), (16, 40, 88, 3)):
        a.rect(x, y, w, h, WOOD_DARK)
    a.rect(13, 15, 94, 1, WOOD)
    a.rect(59, 18, 1, 82, WOOD)
    a.rect(16, 40, 88, 1, WOOD)
    a.rect(8, 102, 104, 3, WOOD)
    a.rect(8, 105, 104, 2, WOOD_DARK)

    a.light(60, 34, 24, LIT, 0.4)
    a.rect(60, 0, 1, 26, INK)
    a.ellipse(60.5, 33, 10, 8, INK, y_max=33)
    a.ellipse(60.5, 33, 9, 7, DEEP_ROSE, y_max=33)
    a.ellipse(58, 31, 5, 4, ROSE, y_max=29)
    a.rect(51, 32, 20, 1, INK)
    a.ellipse(60.5, 34, 3.5, 2, LIT_PALE)

    a.ellipse(60, 125, 36, 6, WOOD_DARK)
    a.ellipse(60, 123, 36, 6, WOOD)
    a.ellipse(60, 122, 32, 4, mix(WOOD, LIT_PALE, 0.25))
    a.rect(57, 130, 6, 24, INK)
    a.rect(58, 130, 1, 24, mix(INK, WOOD, 0.4))
    a.ellipse(60, 155, 14, 3, INK)
    for gx in (42, 66):
        a.ellipse(gx + 4.5, 124, 8, 2, CREAM)
        a.ellipse(gx + 4.5, 124.5, 6, 1, mix(CREAM, LAVENDER, 0.4))
        tea_glass(a, gx, 123, 9, 13)
        steam = mix(LAVENDER, wall, 0.3)
        for j, dx in enumerate((4, 5, 5, 4, 3, 3, 4)):
            if j % 3 != 2:
                a.dot(gx + dx, 106 - j, steam)
    return a


def kitten_moon() -> Art:
    a = Art(120, 160, NAVY_DEEP)
    rng = Rand(104)
    sill = 132
    a.bands(0, [(NAVY_DEEP, 34), (NAVY, 30), (NAVY_MID, 30), (NAVY_LIGHT, 30), (mix(NAVY_LIGHT, LAVENDER, 0.18), 20)])
    stars(a, rng, (16, 14, 104, 112), 30, big=4)
    mx, my, mr = 60, 92, 28
    a.light(mx, my, mr + 18, LAVENDER, 0.35)
    a.disc(mx, my, mr, BUTTER)
    a.ellipse(mx - 2, my - 3, mr - 2, mr - 2, CREAM)
    crater = mix(CREAM, BUTTER, 0.7)
    for cx, cy, r in ((49, 80, 3), (70, 74, 2), (66, 99, 2), (77, 90, 1)):
        a.disc(cx, cy, r, crater)
    roofs = mix(NAVY, NAVY_DEEP, 0.4)
    for x, w, top in ((10, 22, 120), (32, 18, 126), (50, 24, 118), (74, 14, 124), (88, 22, 116)):
        a.rect(x, top, w, sill - top, roofs)
        for wx in range(x + 3, x + w - 3, 6):
            if rng.random() < 0.4:
                a.rect(wx, top + 4, 2, 3, mix(LIT, roofs, 0.25))
    a.rect(92, 109, 9, 6, roofs)
    a.rect(93, 115, 1, 2, roofs)
    a.rect(99, 115, 1, 2, roofs)

    def opening(x: int, y: int, m: int = 0) -> bool:
        if not (16 - m <= x < 104 + m and 16 - m <= y < sill):
            return False
        return y >= 60 or (x + 0.5 - 60) ** 2 + (y + 0.5 - 60) ** 2 <= (44 + m) ** 2

    frame, frame_light = mix(NAVY_LIGHT, LAVENDER, 0.25), mix(NAVY_LIGHT, LAVENDER, 0.45)
    a.where(lambda x, y: not opening(x, y, 4), NAVY_MID)
    a.where(lambda x, y: opening(x, y, 4) and not opening(x, y, 1), frame)
    a.where(lambda x, y: opening(x, y, 1) and not opening(x, y), frame_light)
    a.rect(8, sill, 104, 4, mix(LAVENDER, NAVY_LIGHT, 0.35))
    a.rect(8, sill + 4, 104, 3, frame)
    a.rect(8, sill + 7, 104, 1, INK)

    a.poly([(84, sill - 12), (98, sill - 12), (96, sill), (86, sill)], WOOD_DARK)
    a.rect(83, sill - 13, 16, 2, WOOD)
    a.rect(85, sill - 11, 2, 9, mix(WOOD_DARK, WOOD, 0.5))
    for ang, length in ((-125, 13), (-95, 17), (-62, 12), (-150, 8), (-35, 8)):
        rad = math.radians(ang)
        ex, ey = 91 + math.cos(rad) * length, sill - 13 + math.sin(rad) * length
        a.line(91, sill - 13, round(ex), round(ey), LEAF_DARK)
        leaf(a, ex, ey, ang, 6, 2.5, PLANT, LEAF_DARK)

    kitten = [
        "...o..........o.....",
        "...oo........oo.....",
        "...ooo......ooo.....",
        "...oooo....oooo.....",
        "...oooooooooooo.....",
        "..oooooooooooooo....",
        "..oooooooooooooo....",
        "..oooooooooooooo....",
        "..oooooooooooooo....",
        "...oooooooooooo.....",
        "....oooooooooo......",
        ".....oooooooo.......",
        "....oooooooooo......",
        "...oooooooooooo.....",
        "..oooooooooooooo....",
        "..oooooooooooooo....",
        ".oooooooooooooooo...",
        ".oooooooooooooooo...",
        ".oooooooooooooooo...",
        "oooooooooooooooooo..",
        "oooooooooooooooooo..",
        "oooooooooooooooooo.o",
        "oooooooooooooooooo.o",
        ".oooooooooooooooo..o",
        ".ooooooooooooooooooo",
        "..oooooooooooooooo..",
    ]
    kx, ky = 46, sill - len(kitten)
    rim = mix(LAVENDER, NAVY_LIGHT, 0.25)
    for dx, dy in ((-1, 0), (1, 0), (0, -1)):
        a.sprite(kx + dx, ky + dy, kitten, {"o": rim})
    a.sprite(kx, ky, kitten, {"o": INK})
    return a


def sea_corniche() -> Art:
    a = Art(160, 120, SKY_TOP)
    rng = Rand(105)
    horizon = 50
    a.bands(0, [(SKY_TOP, 16), (SKY_MID, 18), (PEACH, 16)])
    cloud(a, 18, 18, 28)
    cloud(a, 92, 12, 18)
    cloud(a, 130, 30, 14)
    x = 0
    for w, h in ((9, 17), (8, 14), (10, 12), (7, 10), (9, 8), (8, 6), (10, 4), (12, 3)):
        a.rect(x, horizon - h, w, h, NEAR if h > 9 else FAR)
        for wy in range(horizon - h + 2, horizon - 1, 3):
            for wx in range(x + 2, x + w - 2, 3):
                a.dot(wx, wy, mix(NEAR, SKY_TOP, 0.3))
        x += w
    a.rect(128, horizon - 6, 18, 6, FAR)
    a.rect(133, horizon - 10, 8, 4, FAR)
    a.rect(136, horizon - 13, 2, 3, FAR)
    for bx in range(128, 146, 3):
        a.dot(bx, horizon - 7, FAR)

    sea = ["#86b9e3", "#6fa5db", "#5b92cf", "#4b80c0"]
    a.bands(horizon, list(zip(sea, (6, 9, 12, 20))), edge=2)
    for y, run, gap in ((53, (2, 3), (9, 16)), (57, (2, 4), (10, 18)), (62, (3, 5), (12, 20)), (68, (4, 7), (12, 22)), (75, (5, 9), (14, 24)), (83, (6, 12), (14, 26))):
        x = rng.randrange(0, 10)
        while x < 160:
            n = rng.randint(*run)
            a.rect(x, y, n, 1, WHITE)
            a.rect(x + 1, y + 1, n, 1, mix(WHITE, a.get(x, y + 2) or sea[3], 0.5))
            x += n + rng.randint(*gap)
    stone, stone_dark = NEAR, "#a99fca"
    for bx in range(-2, 162, 9):
        by = 92 + rng.randint(-1, 1)
        a.ellipse(bx + 4.5, by, 5.5, 3.5, stone_dark)
        a.ellipse(bx + 4, by - 0.5, 4.5, 2.5, stone)
        a.dot(bx + 3, by - 2, FAR)
    for fx in range(0, 160, 11):
        a.ellipse(fx + rng.randint(0, 4), 89.5, rng.randint(3, 5), 1.5, WHITE)
    a.rect(0, 95, 160, 2, CREAM)
    a.rect(0, 97, 160, 11, "#eadfcf")
    a.rect(0, 97, 160, 1, "#d4c4b0")
    for y in (101, 105):
        a.rect(0, y, 160, 1, "#d9cab6")
    for row, (y0, y1) in enumerate(((98, 101), (102, 105), (106, 108))):
        for bx in range(row * 7 % 14, 160, 14):
            a.rect(bx, y0, 1, y1 - y0, "#d9cab6")
    a.rect(0, 108, 160, 12, "#ddd6e6")
    a.rect(0, 108, 160, 1, "#c4bad6")
    for y in (112, 117):
        a.rect(0, y, 160, 1, "#cfc6de")

    lx = 122
    a.rect(lx, 30, 2, 70, INK)
    a.rect(lx - 1, 92, 4, 8, INK)
    a.rect(lx - 2, 99, 6, 2, INK)
    a.rect(lx - 9, 32, 20, 1, INK)
    a.rect(lx, 26, 2, 4, INK)
    for hx in (lx - 9, lx + 10):
        a.rect(hx, 33, 1, 2, INK)
        a.sprite(hx - 2, 35, [".ooo.", "ocwco", "occco", "occco", ".ooo.", "..o.."], {"o": INK, "c": CREAM, "w": WHITE})
    gull = [
        "g.............g",
        "ww...........ww",
        ".www.......www.",
        "..wwww...wwww..",
        "....sswwwss....",
        "......sws......",
    ]
    a.sprite(54, 8, gull, {"w": WHITE, "g": INK, "s": NEAR})
    a.sprite(80, 17, ["g.......g", ".ww...ww.", "..wwsww..", "....s...."], {"w": WHITE, "g": INK, "s": NEAR})
    return a


def lantern_street() -> Art:
    a = Art(120, 160, NAVY_DEEP)
    rng = Rand(106)
    vx, vy = 60, 111
    a.bands(0, [(NAVY_DEEP, 20), (NAVY, 18), (NAVY_MID, 20)])
    stars(a, rng, (30, 0, 90, 50), 14, (WHITE, BUTTER))

    def wall_y(x: float, y_far: float) -> float:
        return vy + (y_far - vy) * abs(vx - x) / 16

    left, right, end = mix(PLUM, WOOD, 0.35), mix(PLUM, WOOD, 0.18), mix(PLUM, WOOD, 0.25)
    a.where(lambda x, y: x < 44 and y >= wall_y(x + 0.5, 52), left)
    a.where(lambda x, y: x >= 76 and y >= wall_y(x + 0.5, 52), right)
    a.rect(44, 52, 32, 72, end)
    a.poly([(44, 124), (76, 124), (120, 160), (0, 160)], mix(PLUM, INK, 0.45))
    for y_far in (64, 76, 88, 100, 112):
        for x in list(range(0, 44)) + list(range(76, 120)):
            y = round(wall_y(x + 0.5, y_far))
            if (x + y_far) % 3:
                a.dot(x, y, mix(left if x < 60 else right, INK, 0.2))
    a.where(lambda x, y: (x < 44 or x >= 76) and wall_y(x + 0.5, 118) <= y < wall_y(x + 0.5, 124), lambda x, y: mix(left if x < 60 else right, INK, 0.3))
    cobble = mix(PLUM, INK, 0.62)

    def on_floor(x: int, y: int) -> bool:
        return 124 <= y and 44 - (y - 124) * 44 / 36 <= x + 0.5 < 76 + (y - 124) * 44 / 36

    for y in (126, 129, 133, 138, 144, 151, 159):
        a.where(lambda x, yy: on_floor(x, yy), cobble, (0, y, 120, y + 1))
    for xb in range(-90, 220, 30):
        for y in range(124, 160):
            x = round(vx + (xb - vx) * (y - vy) / (160 - vy))
            if on_floor(x, y):
                a.dot(x, y, cobble)
    for x0, x1, lit in ((22, 33, False), (87, 98, True)):
        frame_c = mix(left if x0 < 60 else right, CREAM, 0.2)
        for x in range(x0 - 1, x1 + 1):
            s = abs(vx - (x + 0.5)) / 16
            u = min(max((x + 0.5 - x0) / (x1 - x0), 0.0), 1.0)
            top = wall_y(x + 0.5, 100) - 5 * math.sin(math.pi * u) * s
            for y in range(math.floor(top) - 2, math.ceil(wall_y(x + 0.5, 124))):
                if x in (x0 - 1, x1) or y < top:
                    c = frame_c
                elif lit:
                    c = mix(WOOD_DARK, INK, 0.3) if x < x0 + 3 else LIT_PALE if x0 + 5 <= x < x1 - 3 else LIT
                else:
                    c = INK if x == (x0 + x1) // 2 else mix(WOOD_DARK, INK, 0.35)
                a.dot(x, y, c)
    a.light(94, 134, 12, LIT, 0.3)
    a.rect(52, 100, 16, 24, INK)
    a.ellipse(60, 101, 8, 8, INK, y_max=101)
    a.rect(53, 101, 14, 23, LIT)
    a.ellipse(60, 101.5, 7, 7, LIT, y_max=101)
    a.rect(56, 104, 8, 20, LIT_PALE)
    a.rect(53, 66, 14, 18, INK)
    a.where(lambda x, y: (x + y) % 3 == 0, mix(LIT, end, 0.3), (54, 67, 66, 83))
    a.rect(52, 84, 16, 2, WOOD_DARK)
    a.light(60, 118, 22, LIT, 0.35)

    for s, kinds in ((1.35, ("s", "s", "s")), (2.0, ("m", "m", "m")), (3.0, ("l", "l", "l"))):
        xl, xr = round(vx - 16 * s), round(vx + 16 * s)
        y_attach = round(vy + (80 - vy) * s)
        pts = a.wire(xl, y_attach, xr, y_attach, 5 * s, INK)
        for i, kind in enumerate(kinds):
            px = round(xl + (xr - xl) * (i + 1) / 4)
            py = pts[px - xl][1]
            glass, side = (LIT_PALE, LIT) if i % 2 == 0 else (BLUSH, ROSE)
            size = {"s": (5, 8), "m": (7, 13), "l": (11, 19)}[kind]
            a.light(px, py + 2 + size[1] * 0.6, size[0] * 1.35, LIT, 0.28)
            a.rect(px, py, 1, 2, INK)
            fanous(a, px, py + 2, kind, glass, side)
        for k, (fx, fy) in enumerate(pts[2::max(3, round(2.5 * s))]):
            if any(abs(fx - round(xl + (xr - xl) * (i + 1) / 4)) < 6 * s for i in range(3)):
                continue
            c = (ROSE, BUTTER, LAVENDER, SAGE)[k % 4]
            fs = max(1, round(s))
            for j in range(fs + 1):
                a.rect(fx - fs + j, fy + 1 + j, 2 * (fs - j) + 1, 1, c)
    return a


def park_bench() -> Art:
    a = Art(160, 120, SKY_TOP)
    rng = Rand(107)
    a.bands(0, [(SKY_TOP, 18), (SKY_MID, 20), (PEACH, 18)])
    cloud(a, 12, 16, 26)
    cloud(a, 64, 26, 16)
    for x, w, h in ((0, 12, 14), (12, 8, 18), (20, 14, 11), (60, 10, 16), (70, 12, 12), (82, 8, 9)):
        a.rect(x, 56 - h, w, h, FAR)
    grass = ["#b9d9a0", "#a3cc8c", "#90c07c"]
    hedge, hedge_dark = SAGE, "#a9c79f"
    for i, x in enumerate(range(-6, 170, 13)):
        r = 8 + (i * 5) % 4
        a.ellipse(x, 57, r, 6 + i % 3, hedge_dark)
        a.ellipse(x - 1, 56, r - 1, 5 + i % 3, hedge)
    a.bands(58, list(zip(grass, (8, 16, 38))), edge=2)
    for _ in range(70):
        x, y = rng.randrange(0, 160), rng.randrange(62, 120)
        a.sprite(x, y, ["o.o", ".o."], {"o": mix(a.get(x, y) or grass[2], PLANT, 0.45)})

    def path_at(t: float) -> tuple[float, float, float]:
        x = (1 - t) ** 3 * 30 + 3 * (1 - t) ** 2 * t * 36 + 3 * (1 - t) * t * t * 70 + t ** 3 * 92
        y = (1 - t) ** 3 * 121 + 3 * (1 - t) ** 2 * t * 100 + 3 * (1 - t) * t * t * 92 + t ** 3 * 84
        return x, y, 40 - 26 * t

    ts = [i / 20 for i in range(21)]
    edge_pts = [(x - w / 2, y) for x, y, w in map(path_at, ts)] + [(x + w / 2, y) for x, y, w in map(path_at, reversed(ts))]
    a.poly([(x, y + 1) for x, y in edge_pts], "#ddc8ab")
    a.poly(edge_pts, "#f1e3cf")

    a.poly([(116, 98), (126, 98), (122, 40), (118, 40)], WOOD_DARK)
    a.poly([(116, 98), (120, 98), (119, 40), (118, 40)], WOOD)
    a.line(119, 62, 104, 44, WOOD_DARK)
    a.line(121, 56, 136, 40, WOOD_DARK)
    a.ellipse(121, 99, 12, 2.5, mix(grass[2], PLANT, 0.5))
    blobs = ((100, 40, 20, 13), (124, 32, 22, 15), (112, 22, 17, 11), (140, 44, 14, 10), (90, 50, 11, 7), (132, 18, 12, 8))
    for cx, cy, rx, ry in blobs:
        a.ellipse(cx, cy, rx, ry, ROSE)
    for cx, cy, rx, ry in blobs:
        a.ellipse(cx - 2, cy - 2, rx - 2, ry - 2, BLUSH)
    for cx, cy, rx, ry in blobs:
        for _ in range(round(rx * ry / 9)):
            x, y = round(cx - rx * 0.9 * rng.random()), round(cy - ry * 0.8 * rng.random())
            if a.get(x, y) == BLUSH:
                a.rect(x, y, 2, 1, CREAM)
                a.dot(x, y - 1, CREAM)
    for _ in range(50):
        x, y = rng.randrange(80, 156), rng.randrange(8, 56)
        if a.get(x, y) == ROSE:
            a.rect(x, y, 2, 1, BLUSH)
    for _ in range(26):
        x, y = rng.randrange(64, 160), rng.randrange(56, 112)
        if a.get(x, y) in grass or a.get(x, y) == "#f1e3cf":
            a.dot(x, y, BLUSH if rng.random() < 0.6 else ROSE)

    a.ellipse(84, 96, 22, 2.5, mix(grass[2], PLANT, 0.5))
    for x in (64, 102):
        a.rect(x, 70, 2, 26, INK)
    for y in (70, 75):
        a.rect(62, y, 44, 3, WOOD)
        a.rect(62, y + 2, 44, 1, WOOD_DARK)
    a.rect(60, 82, 48, 2, WOOD)
    a.rect(60, 84, 48, 2, WOOD_DARK)
    for x in (62, 104):
        a.rect(x, 86, 2, 9, INK)
        a.rect(x - 1, 79, 4, 1, INK)
        a.rect(x - 1, 79, 1, 4, INK)
    return a


def cairo_tower() -> Art:
    a = Art(120, 160, NAVY_DEEP)
    rng = Rand(108)
    bank = 106
    a.bands(0, [(NAVY_DEEP, 30), (NAVY, 30), (NAVY_MID, 26), (NAVY_LIGHT, 20)])
    stars(a, rng, (0, 0, 120, 70), 22, big=2)

    lights = []
    for x, w, top in skyline(a, rng, 0, 120, bank, (6, 18), (5, 11), NAVY):
        for wy in range(top + 2, bank - 2, 4):
            for wx in range(x + 1, x + w - 1, 3):
                if rng.random() < 0.22:
                    c = rng.choice((LIT, LIT_PALE, LIT, ROSE))
                    a.dot(wx, wy, c)
                    lights.append((wx, c))
    skyline(a, rng, -4, 124, bank, (2, 7), (8, 16), NAVY_DEEP)
    for px, h, lean in ((44, 22, -0.15), (52, 16, 0.2), (82, 20, 0.15), (90, 13, -0.2)):
        palm(a, px, bank, h, INK, lean)

    cx = 66
    a.light(cx, 36, 18, LIT, 0.2)
    gap, line = mix(DEEP_ROSE, PLUM, 0.35), LIT
    for y in range(44, bank):
        hw = 4 + round((y - 44) / 61)
        for x in range(cx - hw, cx + hw + 1):
            if x in (cx - hw, cx + hw):
                c = mix(line, gap, 0.45)
            else:
                c = line if (x - y) % 4 == 0 or (x + y) % 4 == 0 else gap
            a.dot(x, y, c)
    for i, y in enumerate(range(40, 44)):
        a.rect(cx - 8 + (3 - i), y, 17 - 2 * (3 - i), 1, mix(line, gap, 0.3) if i % 2 else line)
    a.rect(cx - 9, 36, 19, 4, gap)
    for x in range(cx - 8, cx + 9, 2):
        a.rect(x, 37, 1, 2, LIT_PALE)
    a.rect(cx - 8, 35, 17, 1, LIT)
    a.rect(cx - 4, 31, 9, 4, gap)
    for x in range(cx - 3, cx + 4, 2):
        a.dot(x, 32, LIT_PALE)
    a.rect(cx - 3, 29, 7, 2, LIT)
    a.rect(cx, 14, 1, 15, LIT_PALE)
    a.dot(cx, 13, ROSE)

    water = [NAVY_LIGHT, NAVY_MID, NAVY, NAVY_DEEP]
    a.rect(0, bank, 120, 2, INK)
    a.bands(bank + 2, list(zip(water, (8, 14, 14, 16))), edge=2)
    glints(a, rng, (0, bank + 4, 120, 160), 50, {NAVY_MID: NAVY_LIGHT, NAVY: NAVY_MID, NAVY_DEEP: NAVY}, run=(3, 8))
    for wx, c in lights:
        if rng.random() < 0.5:
            for y in range(bank + 3, bank + 3 + rng.randint(6, 20), 2):
                a.dot(wx + rng.randint(-1, 1), y, mix(c, NAVY, 0.3))
    for i, y in enumerate(range(bank + 3, 156, 2)):
        hw = 5 + i // 5
        dashes(a, rng, cx - hw + rng.randint(-1, 1), cx + hw, y, LIT if i < 10 else mix(LIT, gap, 0.4), run=(2, 4), gap=(1, 3))
    return a


def pyramids_stars() -> Art:
    a = Art(160, 120, NAVY_DEEP)
    rng = Rand(109)
    a.bands(0, [(NAVY_DEEP, 22), (NAVY, 22), (NAVY_MID, 22), (NAVY_LIGHT, 34)])
    stars(a, rng, (0, 0, 160, 84), 70, big=6)
    faint = (mix(NAVY_MID, LAVENDER, 0.3), mix(NAVY_MID, BUTTER, 0.3))
    for _ in range(140):
        x = rng.randrange(0, 160)
        y = round(8 + (x - 20) * 0.45 + rng.gauss(0, 3.5))
        if 0 <= y < 80:
            a.dot(x, y, rng.choice(faint))
    for y in range(8, 34):
        for x in range(116, 144):
            if (x - 130) ** 2 + (y - 20) ** 2 <= 110 and (x - 134) ** 2 + (y - 17) ** 2 > 90:
                a.dot(x, y, BUTTER)

    def pyramid(ax: float, ay: float, l: float, r: float, m: float, base: float, lit: str, shade: str, cap: float = 0) -> None:
        a.poly([(ax, ay), (m, base), (l, base)], shade)
        a.poly([(ax, ay), (r, base), (m, base)], lit)
        for y in range(math.ceil(ay) + 3, math.floor(base), 3):
            a.recolour({lit: mix(lit, shade, 0.25), shade: mix(shade, NAVY_DEEP, 0.2)}, (0, y, 160, y + 1))
        if cap:
            a.recolour({lit: mix(lit, FAR, 0.5), shade: mix(shade, lit, 0.35)}, (0, math.floor(ay), 160, math.floor(ay + cap)))

    lit, shade = "#a89ccb", "#5c5392"
    pyramid(146, 66, 126, 166, 150, 96, mix(lit, NAVY_LIGHT, 0.2), mix(shade, NAVY_LIGHT, 0.2))
    pyramid(104, 40, 61, 149, 115, 96, lit, shade, cap=8)
    pyramid(50, 32, 3, 101, 62, 96, lit, shade)
    dune1, dune1_top, dune2, dune2_top = "#463e7a", "#6d63a6", "#363066", "#544b8e"
    for x in range(160):
        t1 = round(90 + 2.5 * math.sin(x / 13) + 1.5 * math.sin(x / 5.3))
        a.rect(x, t1, 1, 120 - t1, dune1)
        a.dot(x, t1, dune1_top)
    for x in range(160):
        t2 = round(104 + 5 * math.sin(x / 21 + 1.2) + 2 * math.sin(x / 9))
        a.rect(x, t2, 1, 120 - t2, dune2)
        a.dot(x, t2, dune2_top)
    return a


def desert_camel() -> Art:
    a = Art(160, 120, LAVENDER)
    rng = Rand(110)
    a.bands(0, [(LAVENDER, 12), (BLUSH, 14), (PEACH, 16), (BUTTER, 40)])
    a.disc(34, 56, 12, GOLD)
    a.disc(34, 56, 10, LIT_PALE)
    a.disc(34, 56, 8, CREAM)

    def dune(px: float, py: float, left: float, right: float, foot: float, lit: str, shade: str, k: float = 0.55) -> None:
        for x in range(max(0, math.floor(left)), min(160, math.ceil(right))):
            xc = x + 0.5
            if xc < px:
                u = (px - xc) / (px - left)
                top = py + (foot - py) * u * u * (3 - 2 * u)
            else:
                u = (xc - px) / (right - px)
                top = py + (foot - py) * (1 - (1 - u) ** 2)
            for y in range(round(top), 120):
                a.dot(x, y, shade if xc > px and xc - px > (y + 0.5 - py) * k else lit)

    for px, py, left, right in ((30, 60, -50, 66), (108, 58, 40, 146), (156, 61, 126, 210)):
        dune(px, py, left, right, 76, "#f8d6a8", "#efbf98", 0.8)
    for px, py, left, right in ((58, 68, -30, 92), (132, 70, 80, 176)):
        dune(px, py, left, right, 92, "#f7c78a", "#e0a07a")
    plain, ripple = "#f4bd7c", "#e9ab6c"
    a.rect(0, 90, 160, 30, plain)
    for y, gap in ((92, 13), (95, 15), (99, 17), (104, 20), (110, 23), (117, 26)):
        x = rng.randrange(0, gap)
        while x < 160:
            n = rng.randint(3, 3 + (y - 88) // 3)
            a.rect(x, y, n, 1, ripple)
            x += n + gap + rng.randint(0, 6)

    camel = [
        "...ooo",
        "..ooooo",
        "oooooooo",
        "oooooooo",
        "...ooooo",
        ".....oooo..............oooo",
        "......oooo...........oooooooo",
        ".......oooo.........oooooooooo",
        "........oooo......oooooooooooooo",
        ".........oooooooooooooooooooooooo",
        "..........ooooooooooooooooooooooooo",
        "..........oooooooooooooooooooooooooo",
        "...........ooooooooooooooooooooooo.o",
        "............ooooooooooooooooooooo..o",
        "............ooooo.ooo......ooooo...o",
        ".............ooo...oo.......ooo.oo",
        ".............oo....oo.......oo...oo",
        ".............oo....oo.......oo...oo",
        ".............oo....o........o....o",
        ".............o.....o........o....o",
        ".............o.....o........o....o",
        ".............o.....o........o....o",
        ".............o.....o........o....o",
        ".............o.....o........o....o",
        "............oo....oo.......oo...oo",
    ]
    feet, cx0 = 101, 50
    shadow = "#d48d68"
    for j, row in enumerate(camel):
        hgt = len(camel) - 1 - j
        for i, ch in enumerate(row):
            if ch == "o":
                a.rect(round(cx0 + i + hgt * 2.0), round(feet + 1 + hgt * 0.22), 2, 1, shadow)
    a.sprite(cx0, feet - len(camel) + 1, camel, {"o": mix(PLUM, INK, 0.4)})
    for px, py, left, right in ((14, 102, -80, 46), (150, 106, 110, 210)):
        dune(px, py, left, right, 126, "#efab68", "#c47a62")
    return a


def beach_umbrella() -> Art:
    a = Art(160, 120, SKY_TOP)
    rng = Rand(111)
    a.bands(0, [(SKY_TOP, 20), (SKY_MID, 22)])
    cloud(a, 16, 14, 24)
    cloud(a, 118, 22, 18)
    sea = ["#4fa6c4", "#5fbacb", "#7fcfd2", "#a6e0d8"]
    a.bands(42, list(zip(sea, (7, 9, 9, 5))), edge=2)
    glints(a, rng, (0, 44, 160, 72), 40, {sea[0]: sea[1], sea[1]: sea[2], sea[2]: WHITE, sea[3]: WHITE}, run=(2, 6))
    sand, wet, sand_dark = "#f8e6c8", "#ead0aa", "#ecd3b0"
    a.rect(0, 72, 160, 48, sand)
    a.rect(0, 72, 160, 4, wet)
    for x in range(160):
        y = round(71 + 1.2 * math.sin(x / 6) + 0.8 * math.sin(x / 2.3))
        a.rect(x, y, 1, 2, WHITE)
    for gy in range(80, 120, 6):
        for gx in range(rng.randrange(0, 6), 160, 9):
            a.dot(gx + rng.randint(0, 3), gy + rng.randint(0, 2), sand_dark)

    a.ellipse(108, 106, 32, 5.5, sand_dark)
    stripes = (LAVENDER, CREAM, BLUSH, CREAM)
    for j in range(12):
        y = 98 + j
        a.rect(40 - j // 2, y, 46, 1, stripes[(j // 3) % 4])
    for y in range(98, 110, 2):
        a.dot(39 - (y - 98) // 2, y, CREAM)
        a.dot(86 - (y - 98) // 2, y, CREAM)
    bx, by = 138, 100
    a.disc(bx, by, 5, ROSE)
    a.where(lambda x, y: x > bx and (x - bx) ** 2 + (y - by) ** 2 <= 30 and y < by + 1, BUTTER)
    a.where(lambda x, y: y > by + 1 and (x - bx) ** 2 + (y - by) ** 2 <= 30, CREAM)
    a.dot(bx - 2, by - 3, WHITE)

    ux, top, rim, rx = 100, 40, 60, 34
    a.rect(ux, top, 2, 68, CREAM)
    a.rect(ux + 1, top, 1, 68, "#e3cfb8")
    for y in range(top, rim):
        for x in range(ux - rx, ux + rx + 2):
            dx = (x + 0.5 - ux - 1) / rx
            dy = (y + 0.5 - rim) / (rim - top)
            if dx * dx + dy * dy > 1:
                continue
            rim_x = (x + 0.5 - ux - 1) * (rim - top) / (y + 0.5 - top)
            k = min(6, int(math.acos(max(-1.0, min(1.0, rim_x / rx))) / (math.pi / 7)))
            a.dot(x, y, ROSE if k % 2 == 0 else CREAM)
    for k in range(7):
        x0 = ux + 1 + rx * math.cos(math.pi * (k + 1) / 7)
        x1 = ux + 1 + rx * math.cos(math.pi * k / 7)
        a.ellipse((x0 + x1) / 2, rim, (x1 - x0) / 2, 2.5, ROSE if k % 2 == 0 else CREAM)
        a.ellipse((x0 + x1) / 2, rim + 0.5, (x1 - x0) / 2 - 0.5, 2, DEEP_ROSE if k % 2 == 0 else "#ead7c8")
        a.ellipse((x0 + x1) / 2, rim - 0.5, (x1 - x0) / 2, 2, ROSE if k % 2 == 0 else CREAM)
    a.rect(ux, top - 3, 2, 3, INK)
    return a


def train_window() -> Art:
    a = Art(160, 120, SKY_TOP)
    rng = Rand(112)
    a.bands(0, [(SKY_TOP, 26), (SKY_MID, 20), (PEACH, 14)])
    cloud(a, 30, 22, 26)
    cloud(a, 96, 16, 20)
    cloud(a, 130, 34, 12)
    for x in range(160):
        y = round(52 + 3 * math.sin(x / 17) + 2 * math.sin(x / 7 + 1))
        a.rect(x, y, 1, 10, SAGE)
    fields = [("#b9d9a0", 3), ("#f3dc8e", 4), ("#9fcc88", 5), ("#e9d27c", 6), ("#a9d18e", 8), ("#8fc07c", 12), ("#f0d888", 14)]
    y = 58
    for c, h in fields:
        a.rect(0, y, 160, h, c)
        rows = mix(c, PLANT, 0.25)
        if h >= 6:
            for xb in range(-300, 460, 9 + h):
                for yy in range(y + 1, y + h):
                    a.dot(round(80 + (xb - 80) * (yy - 40) / 80), yy, rows)
        y += h
    for tx in range(4, 160, 15):
        ty = 58 + rng.randint(0, 6)
        a.ellipse(tx + rng.randint(0, 5), ty, 3, 2.5, PLANT)
    a.rect(118, 60, 8, 4, CREAM)
    a.poly([(117, 60), (122, 56), (127, 60)], ROSE)

    poles = ((44, 20, 100, 2, 16), (110, 40, 66, 1, 8), (138, 50, 62, 1, 4))
    for x, top, bottom, w, arm in poles:
        a.rect(x, top, w, bottom - top, WOOD_DARK)
        a.rect(x - arm // 2, top + 3, arm + w, 1, WOOD_DARK)
        for ix in (x - arm // 2, x + arm // 2 + w - 1):
            a.dot(ix, top + 2, CREAM)
    wire = mix(INK, SKY_TOP, 0.4)
    for (x0, y0), (x1, y1), sag in (((-4, 10), (36, 22), 5), ((-4, 14), (53, 22), 6), ((36, 22), (106, 42), 6), ((53, 22), (114, 42), 6), ((106, 42), (136, 52), 3), ((114, 42), (140, 52), 3)):
        a.wire(x0, y0, x1, y1, sag, wire)

    wall, panel = NEAR, "#ada3cf"

    def inside(x: int, y: int, m: int = 0) -> bool:
        x0, y0, x1, y1, r = 18 - m, 12 - m, 142 + m, 94 + m, 10 + m
        if not (x0 <= x < x1 and y0 <= y < y1):
            return False
        cx = min(max(x + 0.5, x0 + r), x1 - r)
        cy = min(max(y + 0.5, y0 + r), y1 - r)
        return (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r

    a.where(lambda x, y: not inside(x, y, 6), wall)
    a.where(lambda x, y: inside(x, y, 6) and not inside(x, y, 5), WOOD_DARK)
    a.where(lambda x, y: inside(x, y, 5) and not inside(x, y, 1), WOOD)
    a.where(lambda x, y: inside(x, y, 1) and not inside(x, y), WOOD_DARK)
    a.where(lambda x, y: inside(x, y, 5) and not inside(x, y, 3) and y < 50, mix(WOOD, LIT_PALE, 0.3))
    for i in range(14):
        a.dot(118 + i, 30 - i, mix(SKY_TOP, WHITE, 0.6))
        a.dot(124 + i, 30 - i, mix(SKY_TOP, WHITE, 0.6))
        a.dot(125 + i, 30 - i, mix(SKY_TOP, WHITE, 0.6))
    a.rect(0, 104, 160, 16, panel)
    a.rect(0, 104, 160, 1, mix(panel, INK, 0.2))
    a.rect(10, 101, 140, 3, WOOD)
    a.rect(10, 104, 140, 2, WOOD_DARK)
    return a


def sunset_roofs() -> Art:
    a = Art(160, 120, SUNSET_PINK)
    rng = Rand(113)
    a.bands(0, [(SUNSET_PINK, 14), (mix(SUNSET_PINK, ORANGE, 0.5), 16), (ORANGE, 20), (GOLD, 22), (BUTTER, 30)])
    a.disc(98, 72, 15, LIT_PALE)
    a.disc(98, 72, 13, CREAM)
    far, mid, near = mix(PLUM, SUNSET_PINK, 0.5), mix(PLUM, SUNSET_PINK, 0.22), mix(PLUM, INK, 0.45)
    skyline(a, rng, 0, 160, 86, (4, 12), (6, 14), far)
    dome(a, 62, 74, 7, far, drum=12)
    minaret(a, 74, 86, 26, far)
    dome(a, 128, 76, 5, far, drum=10)
    for x, w, top in skyline(a, rng, -4, 164, 96, (4, 14), (10, 20), mid):
        if rng.random() < 0.4:
            dish(a, x + 6, top - 4, 2, mid, 2)
        elif rng.random() < 0.5:
            a.rect(x + 3, top - 5, 7, 4, mid)
            a.rect(x + 4, top - 1, 1, 1, mid)
            a.rect(x + 8, top - 1, 1, 1, mid)
    a.rect(0, 96, 160, 24, mid)
    minaret(a, 30, 96, 66, mid)

    roofs = ((-2, 30, 98), (28, 26, 104), (54, 30, 100), (84, 20, 106), (104, 56, 102))
    for x, w, top in roofs:
        a.rect(x, top, w, 120 - top, near)
        for wy in range(top + 5, 118, 8):
            for wx in range(x + 4, x + w - 4, 7):
                if rng.random() < 0.35:
                    a.rect(wx, wy, 3, 4, LIT)
    for x, y, top in ((10, 91, 98), (62, 93, 100), (71, 95, 100), (113, 95, 102)):
        dish(a, x, y, 3, near, top - y - 3)
    a.rect(34, 97, 12, 7, near)
    a.rect(35, 95, 10, 2, near)
    a.rect(86, 98, 1, 8, near)
    a.rect(98, 98, 1, 8, near)
    a.rect(86, 98, 13, 1, near)
    for i, c in enumerate((ROSE, CREAM, LAVENDER)):
        a.rect(88 + i * 4, 99, 3, 4 + i % 2, mix(c, near, 0.35))
    tx, ttop = 128, 40
    for x in (tx, tx + 12):
        a.rect(x, ttop + 12, 1, 102 - ttop - 12, near)
    for y in range(ttop + 12, 100, 10):
        a.line(tx, y, tx + 12, y + 10, near)
        a.line(tx + 12, y, tx, y + 10, near)
    a.rect(tx - 3, ttop, 19, 12, near)
    for hx in range(tx - 1, tx + 15, 3):
        for hy in (ttop + 3, ttop + 7):
            a.dot(hx, hy, a.get(hx, ttop - 2) or GOLD)
    for x, h in ((tx - 3, 8), (tx + 15, 10), (tx + 6, 14)):
        a.rect(x, ttop - h, 1, h, near)
    a.rect(tx + 7, ttop - 14, 4, 3, DEEP_ROSE)
    for x, y in ((112, 30), (119, 25), (146, 28), (138, 20), (104, 38)):
        bird(a, x, y, near)
    return a


def flowers_vase() -> Art:
    a = Art(120, 160, CREAM)
    a.bands(0, [(CREAM, 96), (mix(CREAM, BLUSH, 0.35), 24)], edge=3)

    wx0, wy0, wx1, wy1 = 14, 14, 86, 100
    a.bands(wy0, [(SKY_TOP, 30), (SKY_MID, 30), (PEACH, 26)], x0=wx0, x1=wx1)
    cloud(a, 22, 34, 22)
    for x, w, h in ((14, 10, 16), (24, 8, 22), (32, 12, 12), (44, 9, 18), (53, 12, 10), (65, 8, 20), (73, 13, 14)):
        a.rect(x, wy1 - h, w, h, FAR)
        for yy in range(wy1 - h + 3, wy1, 4):
            for xx in range(x + 2, x + w - 2, 3):
                a.dot(xx, yy, NEAR)
    for x, y, w, h in ((wx0 - 4, wy0 - 4, wx1 - wx0 + 8, 4), (wx0 - 4, wy1, wx1 - wx0 + 8, 4), (wx0 - 4, wy0, 4, wy1 - wy0), (wx1, wy0, 4, wy1 - wy0), (48, wy0, 3, wy1 - wy0), (wx0, 54, wx1 - wx0, 3)):
        a.rect(x, y, w, h, WOOD)
    a.rect(wx0 - 4, wy1 + 3, wx1 - wx0 + 8, 1, WOOD_DARK)
    a.rect(wx0 - 6, wy1 + 2, wx1 - wx0 + 12, 2, WOOD_DARK)

    a.rect(4, 8, 112, 2, WOOD_DARK)
    for y in range(10, 118):
        t = (y - 10) / 108
        pinch = math.exp(-((y - 62) / 18) ** 2)
        x0 = 78 + 10 * pinch
        x1 = 104 - 4 * pinch + 4 * t
        for x in range(round(x0), round(x1)):
            fold = int((x - x0) / max(1.0, (x1 - x0)) * 5) % 2
            a.dot(x, y, ROSE if fold else BLUSH)
        a.dot(round(x0), y, DEEP_ROSE)
    a.rect(86, 60, 16, 3, DEEP_ROSE)

    a.rect(0, 118, 120, 12, WOOD)
    a.poly([(14, 118), (86, 118), (100, 130), (28, 130)], mix(WOOD, LIT_PALE, 0.3))
    a.rect(0, 118, 120, 1, mix(WOOD, CREAM, 0.5))
    a.rect(0, 130, 120, 2, mix(WOOD, CREAM, 0.25))
    a.rect(0, 132, 120, 28, WOOD_DARK)
    a.rect(0, 132, 120, 1, mix(WOOD_DARK, INK, 0.3))
    a.rect(24, 138, 72, 14, mix(WOOD_DARK, INK, 0.3))
    a.rect(25, 139, 70, 12, mix(WOOD_DARK, WOOD, 0.35))
    a.rect(55, 143, 10, 3, BRASS)
    a.rect(56, 143, 8, 1, LIT_PALE)
    a.ellipse(58, 126, 22, 4, CREAM)
    for x in range(36, 81, 3):
        a.dot(x, 126 + (2 if 40 < x < 76 else 1), mix(CREAM, LAVENDER, 0.35))

    a.ellipse(58, 112, 12, 14, "#9fb4d6")
    a.ellipse(58, 112, 11, 13, "#dcecf6")
    a.rect(52, 88, 12, 12, "#9fb4d6")
    a.rect(53, 88, 10, 12, "#dcecf6")
    a.rect(51, 86, 14, 3, "#9fb4d6")
    a.rect(52, 87, 12, 1, WHITE)
    a.where(lambda x, y: ((x + 0.5 - 58) / 11) ** 2 + ((y + 0.5 - 112) / 13) ** 2 <= 1, SKY_MID, (0, 104, 120, 126))
    for sx, lean in ((54, -2), (57, 0), (60, 1), (63, 3)):
        a.line(sx, 120, sx + lean, 88, PLANT)
    a.rect(50, 106, 1, 8, WHITE)
    a.rect(51, 102, 1, 3, WHITE)

    roses = ((44, 66), (57, 57), (70, 63), (50, 77), (65, 76), (79, 74))
    jasmine = ((32, 56), (84, 52), (58, 42), (34, 82), (84, 88))
    for hx, hy in roses + jasmine:
        a.line(58, 88, hx, hy, PLANT)
    for x, y, ang in ((50, 80, -160), (66, 80, -20), (46, 70, -130), (72, 68, -50), (56, 64, -100), (40, 88, 170), (78, 86, 10)):
        leaf(a, x, y, ang, 9, 2.5, PLANT, LEAF_DARK)
    for hx, hy in jasmine:
        for ang in (-150, -30, 90, 200, 20):
            leaf(a, hx, hy, ang, 6, 2, LEAF_DARK, PLANT)
        for dx, dy in ((-3, -1), (2, -3), (1, 2), (-1, 4) if hy > 70 else (4, 1)):
            a.sprite(hx + dx - 2, hy + dy - 2, ["..w..", ".www.", "wwyww", ".www.", "..w.."], {"w": WHITE, "y": BUTTER})
    shade, swirl = mix(ROSE, DEEP_ROSE, 0.4), mix(ROSE, DEEP_ROSE, 0.7)
    for cx, cy in roses:
        a.disc(cx, cy, 5, DEEP_ROSE)
        a.disc(cx, cy, 4, ROSE)
        a.where(lambda x, y: a.get(x, y) == ROSE and (x - cx) + (y - cy) >= 3, shade, (cx - 5, cy - 5, cx + 6, cy + 6))
        a.where(lambda x, y: a.get(x, y) == ROSE and (x - cx) + (y - cy) <= -4, BLUSH, (cx - 5, cy - 5, cx + 6, cy + 6))
        th = 0.6
        while th < 2.1 * math.pi:
            r = 0.4 + th * 0.48
            a.dot(round(cx + math.cos(th) * r), round(cy + math.sin(th) * r * 0.9), swirl)
            th += 0.18
    for x, y in ((74, 124), (80, 122)):
        a.sprite(x, y, ["pp.", ".pd"], {"p": ROSE, "d": DEEP_ROSE})
    return a


SCENES = [
    ("nile-felucca", nile_felucca),
    ("rooftop-lights", rooftop_lights),
    ("cafe-rain", cafe_rain),
    ("kitten-moon", kitten_moon),
    ("sea-corniche", sea_corniche),
    ("lantern-street", lantern_street),
    ("park-bench", park_bench),
    ("cairo-tower", cairo_tower),
    ("pyramids-stars", pyramids_stars),
    ("desert-camel", desert_camel),
    ("beach-umbrella", beach_umbrella),
    ("train-window", train_window),
    ("sunset-roofs", sunset_roofs),
    ("flowers-vase", flowers_vase),
]


def save(art: Art, path: Path) -> None:
    colours = sorted(set(art.p))
    if len(colours) > 256:
        raise SystemExit(f"{path.name}: {len(colours)} colours, more than a palette holds")
    index = {c: i for i, c in enumerate(colours)}
    img = Image.new("P", (art.w, art.h))
    img.putpalette([v for c in colours for v in rgb(c)])
    img.putdata([index[c] for c in art.p])
    img = img.resize((art.w * SCALE, art.h * SCALE), Image.Resampling.NEAREST)
    img.save(path, optimize=True)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, draw in SCENES:
        art = draw()
        path = OUT / f"{name}.png"
        save(art, path)
        print(f"{path.name}: {art.w * SCALE}x{art.h * SCALE}, {len(set(art.p))} colours, {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
