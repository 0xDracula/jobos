"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { LngLatBounds, Map as MapLibre, Marker, addProtocol, setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { useEffect, useRef } from "react";

import { MEMORY_ART } from "@/components/pixel/icons/memories";
import { cn } from "@/lib/cn";
import { CAIRO, mapStyle } from "@/lib/mapStyle";
import type { Place } from "@/lib/memories";
import { useResolvedTheme } from "@/lib/theme";

import { useReducedMotionPref } from "./parts";

const WORKER_URL = new URL("../../../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href;

let ready = false;

function setup() {
  if (ready) return;
  ready = true;
  setWorkerUrl(WORKER_URL);
  addProtocol("pmtiles", new Protocol().tile);
}

export type MapHandle = {
  center: () => { lat: number; lon: number };
  flyTo: (lat: number, lon: number) => void;
};

const OUTLINE = "#2e2c48";

function pixelPin(size: number): string {
  const { rows, pal } = MEMORY_ART.pin;
  let rects = "";
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = (pal as Record<string, string>)[row[x]];
      if (!c) {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < row.length && row[x + w] === row[x]) w++;
      rects += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${c}"/>`;
      x += w;
    }
  });
  return `<svg width="${size}" height="${size}" viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

function pinPhoto(place: Place): { src: string; color: string; pixelated: boolean } | null {
  const p = place.photo;
  const src = p?.status === "ready" ? (p.thumb_url ?? p.url) : null;
  return src ? { src, color: p?.color ?? "#f7c6d0", pixelated: !!p?.placeholder } : null;
}

const pinKey = (place: Place) => JSON.stringify([place.name, pinPhoto(place)]);

function drawPin(inner: HTMLElement, place: Place) {
  const photo = pinPhoto(place);
  inner.replaceChildren();
  if (!photo) {
    inner.innerHTML = pixelPin(40);
    inner.style.filter = "drop-shadow(0 3px 4px rgba(10, 8, 30, 0.35))";
    inner.style.marginBottom = "-7px";
    inner.style.transformOrigin = "50% 83%";
    return;
  }
  inner.style.filter = "";
  inner.style.marginBottom = "";
  inner.style.transformOrigin = "50% 100%";
  const frame = document.createElement("span");
  frame.style.cssText = `display:block;padding:3px 3px 8px;background:#fff8ef;border:2px solid ${OUTLINE};border-radius:3px;box-shadow:0 4px 10px rgba(10,8,30,0.35);`;
  const img = document.createElement("img");
  img.src = photo.src;
  img.alt = "";
  img.draggable = false;
  img.style.cssText = `display:block;width:40px;height:40px;object-fit:cover;background:${photo.color};${photo.pixelated ? "image-rendering:pixelated;" : ""}`;
  frame.append(img);
  const tip = document.createElement("span");
  tip.style.cssText = `display:block;width:0;height:0;margin:-1px auto 0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${OUTLINE};`;
  inner.append(frame, tip);
}

type Pin = { marker: Marker; root: HTMLButtonElement; inner: HTMLElement; key: string };

export default function PlacesMap({
  places,
  selectedId,
  initial,
  onSelect,
  onReady,
  className,
}: {
  places: Place[];
  selectedId: string | null;
  initial?: Place | null;
  onSelect: (place: Place) => void;
  onReady: (handle: MapHandle) => void;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const pins = useRef(new Map<string, Pin>());
  const theme = useResolvedTheme();
  const reduced = useReducedMotionPref();
  const latest = useRef({ places, onSelect, reduced, theme });
  latest.current = { places, onSelect, reduced, theme };
  const shownTheme = useRef(theme);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    setup();
    const { places: list, theme: initialTheme } = latest.current;
    const view: { center?: [number, number]; zoom?: number; bounds?: LngLatBounds } = {};
    if (initial) {
      view.center = [initial.lon, initial.lat];
      view.zoom = 14;
    } else if (list.length) {
      view.bounds = list.reduce((b, p) => b.extend([p.lon, p.lat]), new LngLatBounds([list[0].lon, list[0].lat], [list[0].lon, list[0].lat]));
    } else {
      view.center = CAIRO;
      view.zoom = 11;
    }
    const map = new MapLibre({
      container: el,
      style: mapStyle(initialTheme, window.location.origin) as unknown as StyleSpecification,
      ...view,
      fitBoundsOptions: { padding: { top: 96, bottom: 48, left: 56, right: 56 }, maxZoom: 14 },
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      rollEnabled: false,
      maxPitch: 0,
      renderWorldCopies: false,
      fadeDuration: latest.current.reduced ? 0 : 300,
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    mapRef.current = map;
    shownTheme.current = initialTheme;
    const current = pins.current;
    onReady({
      center: () => {
        const c = map.getCenter();
        return { lat: Number(c.lat.toFixed(6)), lon: Number(c.lng.toFixed(6)) };
      },
      flyTo: (lat, lon) => {
        const zoom = Math.max(map.getZoom(), 14);
        if (latest.current.reduced) map.jumpTo({ center: [lon, lat], zoom });
        else map.flyTo({ center: [lon, lat], zoom, duration: 900 });
      },
    });
    return () => {
      current.forEach((p) => p.marker.remove());
      current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || shownTheme.current === theme) return;
    shownTheme.current = theme;
    map.setStyle(mapStyle(theme, window.location.origin) as unknown as StyleSpecification);
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set<string>();
    for (const place of places) {
      seen.add(place.id);
      let pin = pins.current.get(place.id);
      if (!pin) {
        const root = document.createElement("button");
        root.type = "button";
        root.style.cssText = "background:none;border:0;padding:0;cursor:pointer;border-radius:4px;";
        const inner = document.createElement("span");
        inner.style.cssText = "display:block;transform-origin:50% 100%;";
        root.append(inner);
        const id = place.id;
        root.addEventListener("click", (e) => {
          e.stopPropagation();
          const p = latest.current.places.find((x) => x.id === id);
          if (p) latest.current.onSelect(p);
        });
        const marker = new Marker({ element: root, anchor: "bottom" }).setLngLat([place.lon, place.lat]).addTo(map);
        pin = { marker, root, inner, key: "" };
        pins.current.set(place.id, pin);
      }
      pin.marker.setLngLat([place.lon, place.lat]);
      pin.root.setAttribute("aria-label", place.name);
      pin.root.title = place.name;
      const key = pinKey(place);
      if (pin.key !== key) {
        drawPin(pin.inner, place);
        pin.key = key;
      }
    }
    for (const [id, pin] of pins.current) {
      if (!seen.has(id)) {
        pin.marker.remove();
        pins.current.delete(id);
      }
    }
  }, [places]);

  useEffect(() => {
    for (const [id, pin] of pins.current) {
      const on = id === selectedId;
      pin.inner.style.transition = reduced ? "none" : "transform 160ms ease-out";
      pin.inner.style.transform = on ? "scale(1.3)" : "";
      pin.root.style.zIndex = on ? "3" : "1";
      if (on) pin.root.setAttribute("aria-current", "true");
      else pin.root.removeAttribute("aria-current");
    }
  }, [selectedId, places, reduced]);

  return (
    <div
      ref={container}
      className={cn(
        "size-full",
        "[&_.maplibregl-ctrl-attrib]:bg-panel/85! [&_.maplibregl-ctrl-attrib]:text-[11px]! [&_.maplibregl-ctrl-attrib]:font-semibold [&_.maplibregl-ctrl-attrib]:text-muted! [&_.maplibregl-ctrl-attrib_a]:text-muted!",
        theme === "night" && "[&_.maplibregl-ctrl-attrib-button]:invert",
        className,
      )}
    />
  );
}
