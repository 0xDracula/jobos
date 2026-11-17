export type MapTheme = "day" | "night";

export type MapPalette = {
  earth: string;
  park: string;
  sand: string;
  campus: string;
  water: string;
  waterLabel: string;
  building: string;
  path: string;
  minor: string;
  major: string;
  casing: string;
  highway: string;
  highwayCasing: string;
  rail: string;
  boundary: string;
  label: string;
  labelMuted: string;
  halo: string;
};

export const MAP_PALETTES: Record<MapTheme, MapPalette> = {
  day: {
    earth: "#f7eee6",
    park: "#d4e5ca",
    sand: "#f6e6c8",
    campus: "#f4e3e3",
    water: "#a9d0ee",
    waterLabel: "#3f6f9c",
    building: "#eadcd4",
    path: "#e3d2ca",
    minor: "#ffffff",
    major: "#ffffff",
    casing: "#e5d3c9",
    highway: "#f7c6d0",
    highwayCasing: "#e88fa3",
    rail: "#c9b8f0",
    boundary: "#c9b8f0",
    label: "#3b2f3f",
    labelMuted: "#7a6a7e",
    halo: "#fff7f0",
  },
  night: {
    earth: "#1c1a3d",
    park: "#22334c",
    sand: "#2a2650",
    campus: "#2a2656",
    water: "#0d0f2b",
    waterLabel: "#8fa6e0",
    building: "#2e2b61",
    path: "#2f2c62",
    minor: "#3b3779",
    major: "#4a4594",
    casing: "#24224f",
    highway: "#ffcf7a",
    highwayCasing: "#a77c3a",
    rail: "#6c5fa8",
    boundary: "#6c5fa8",
    label: "#f5eef8",
    labelMuted: "#b6acd0",
    halo: "#1c1a3d",
  },
};

export const CAIRO: [number, number] = [31.2357, 30.0444];

const PARKS = ["park", "garden", "golf_course", "grass", "grassland", "meadow", "forest", "nature_reserve", "recreation_ground", "village_green", "zoo", "playground", "pitch", "cemetery", "farmland", "scrub", "wood"];
const SAND = ["sand", "beach", "bare_rock"];
const CAMPUS = ["hospital", "school", "university", "college"];

const nameEn = ["get", "name:en"];
const hasNameEn = ["has", "name:en"];

const width = (...stops: number[]) => ["interpolate", ["exponential", 1.6], ["zoom"], ...stops];

export function mapStyle(theme: MapTheme, origin: string): Record<string, unknown> {
  const c = MAP_PALETTES[theme];
  const kindIn = (kinds: string[]) => ["in", ["get", "kind"], ["literal", kinds]];
  const road = (id: string, kinds: string[], color: string, w: unknown[], extra: Record<string, unknown> = {}) => ({
    id,
    type: "line",
    source: "protomaps",
    "source-layer": "roads",
    filter: ["all", kindIn(kinds), ["!=", ["get", "is_tunnel"], true]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": color, "line-width": w, ...extra },
  });
  return {
    version: 8,
    name: `Rooftop ${theme}`,
    glyphs: `${origin}/api/map/fonts/{fontstack}/{range}.pbf`,
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${origin}/api/map/tiles.pmtiles`,
        attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a> · <a href="https://protomaps.com">Protomaps</a>',
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": c.earth } },
      { id: "earth", type: "fill", source: "protomaps", "source-layer": "earth", paint: { "fill-color": c.earth } },
      { id: "parks", type: "fill", source: "protomaps", "source-layer": "landuse", filter: kindIn(PARKS), paint: { "fill-color": c.park } },
      { id: "sand", type: "fill", source: "protomaps", "source-layer": "landuse", filter: kindIn(SAND), paint: { "fill-color": c.sand } },
      { id: "campus", type: "fill", source: "protomaps", "source-layer": "landuse", filter: kindIn(CAMPUS), paint: { "fill-color": c.campus } },
      { id: "water", type: "fill", source: "protomaps", "source-layer": "water", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": c.water } },
      {
        id: "waterways",
        type: "line",
        source: "protomaps",
        "source-layer": "water",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": c.water, "line-width": width(10, 0.5, 16, 3) },
      },
      {
        id: "buildings",
        type: "fill",
        source: "protomaps",
        "source-layer": "buildings",
        minzoom: 13,
        filter: ["==", ["get", "kind"], "building"],
        paint: { "fill-color": c.building, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 14.5, 0.9] },
      },
      road("paths", ["path"], c.path, width(14, 0.5, 18, 2), { "line-dasharray": [2, 1.5] }),
      road("rail", ["rail"], c.rail, width(12, 0.5, 18, 2), { "line-dasharray": [3, 2] }),
      road("minor-casing", ["minor_road"], c.casing, width(12, 0.8, 18, 14), { "line-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 14, 1] }),
      road("major-casing", ["major_road"], c.casing, width(8, 0.8, 18, 22), { "line-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0, 12, 1] }),
      road("highway-casing", ["highway"], c.highwayCasing, width(6, 0.8, 18, 26), { "line-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0, 10, 1] }),
      road("minor", ["minor_road", "other"], c.minor, width(12, 0.4, 18, 11)),
      road("major", ["major_road"], c.major, width(8, 0.5, 18, 18)),
      road("highway", ["highway"], c.highway, width(6, 0.6, 18, 22)),
      {
        id: "boundaries",
        type: "line",
        source: "protomaps",
        "source-layer": "boundaries",
        paint: { "line-color": c.boundary, "line-width": 1, "line-dasharray": [3, 2] },
      },
      {
        id: "river-labels",
        type: "symbol",
        source: "protomaps",
        "source-layer": "water",
        filter: ["all", hasNameEn, ["==", ["geometry-type"], "LineString"]],
        layout: {
          "symbol-placement": "line",
          "text-field": nameEn,
          "text-font": ["Noto Sans Italic"],
          "text-size": 13,
          "text-letter-spacing": 0.08,
        },
        paint: { "text-color": c.waterLabel, "text-halo-color": c.halo, "text-halo-width": 1.5 },
      },
      {
        id: "water-labels",
        type: "symbol",
        source: "protomaps",
        "source-layer": "water",
        minzoom: 11,
        filter: ["all", hasNameEn, ["!=", ["geometry-type"], "LineString"], kindIn(["river", "canal", "lake", "water", "basin"])],
        layout: {
          "text-field": nameEn,
          "text-font": ["Noto Sans Italic"],
          "text-size": 13,
          "text-letter-spacing": 0.08,
          "text-max-width": 8,
        },
        paint: { "text-color": c.waterLabel, "text-halo-color": c.halo, "text-halo-width": 1.5 },
      },
      {
        id: "road-labels",
        type: "symbol",
        source: "protomaps",
        "source-layer": "roads",
        minzoom: 13,
        filter: ["all", hasNameEn, kindIn(["highway", "major_road", "minor_road"])],
        layout: {
          "symbol-placement": "line",
          "text-field": nameEn,
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
        },
        paint: { "text-color": c.labelMuted, "text-halo-color": c.halo, "text-halo-width": 1.5 },
      },
      {
        id: "neighbourhoods",
        type: "symbol",
        source: "protomaps",
        "source-layer": "places",
        filter: ["all", hasNameEn, ["==", ["get", "kind"], "neighbourhood"], ["<=", ["coalesce", ["get", "min_zoom"], 0], ["+", ["zoom"], 1]]],
        layout: {
          "text-field": nameEn,
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 11, 11, 16, 14],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.1,
          "text-max-width": 7,
        },
        paint: { "text-color": c.labelMuted, "text-halo-color": c.halo, "text-halo-width": 1.5 },
      },
      {
        id: "localities",
        type: "symbol",
        source: "protomaps",
        "source-layer": "places",
        filter: ["all", hasNameEn, ["==", ["get", "kind"], "locality"], ["<=", ["coalesce", ["get", "min_zoom"], 0], ["+", ["zoom"], 1]]],
        layout: {
          "text-field": nameEn,
          "text-font": ["Noto Sans Medium"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 8, 13, 14, 18],
          "text-max-width": 8,
          "symbol-sort-key": ["coalesce", ["get", "sort_key"], 0],
        },
        paint: { "text-color": c.label, "text-halo-color": c.halo, "text-halo-width": 2 },
      },
    ],
  };
}
