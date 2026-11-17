export type Preview = {
  weather: string | null;
  season: string | null;
  room: string | null;
  kitten: string | null;
  holiday: string[] | null;
  milestone: boolean;
  unlock: string | null;
  weekend: boolean;
  lamp: "sent" | "received" | null;
  together: boolean;
  listening: boolean;
  other: boolean;
  bpm: number | null;
  energy: number | null;
  valence: number | null;
  otherWeather: string | null;
};

export const roomClock: { offset: number } & Preview = {
  offset: 0,
  weather: null,
  season: null,
  room: null,
  kitten: null,
  holiday: null,
  milestone: false,
  unlock: null,
  weekend: false,
  lamp: null,
  together: false,
  listening: false,
  other: false,
  bpm: null,
  energy: null,
  valence: null,
  otherWeather: null,
};

export const roomNow = () => new Date(Date.now() + roomClock.offset);

const WEATHERS = ["clear", "clouds", "fog", "drizzle", "rain", "snow", "thunderstorm"];
const SEASONS = ["winter", "spring", "summer", "autumn", "off"];
const ROOMS = ["rooftop", "cafe", "beach", "cabin"];
const POSES = ["sit", "sleep", "stretch", "yawn", "look"];

export function readClockParams() {
  if (process.env.NODE_ENV !== "development") return;
  const q = new URLSearchParams(window.location.search);
  const at = q.get("at");
  if (at) {
    const today = new Date();
    const hhmm = /^(\d{1,2}):(\d{2})$/.exec(at);
    const target = hhmm ? new Date(today.getFullYear(), today.getMonth(), today.getDate(), Number(hhmm[1]), Number(hhmm[2])) : new Date(at);
    if (!Number.isNaN(target.getTime())) roomClock.offset = target.getTime() - Date.now();
  }
  const pick = (name: string, allowed: string[]) => {
    const v = q.get(name);
    return v && allowed.includes(v) ? v : null;
  };
  roomClock.weather = pick("weather", WEATHERS);
  roomClock.season = pick("season", SEASONS);
  roomClock.room = pick("room", ROOMS);
  roomClock.kitten = pick("kitten", POSES);
  const holiday = q.get("holiday");
  roomClock.holiday = holiday ? holiday.split(",").map((s) => s.trim()).filter(Boolean) : null;
  roomClock.milestone = q.get("milestone") === "1";
  roomClock.unlock = q.get("unlock");
  roomClock.weekend = q.get("weekend") === "1";
  const lamp = q.get("lamp");
  roomClock.lamp = lamp === "sent" || lamp === "received" ? lamp : null;
  roomClock.together = q.get("together") === "1";
  roomClock.listening = q.get("listening") === "1";
  roomClock.other = q.get("other") === "1";
  const num = (name: string, min: number, max: number) => {
    const v = Number(q.get(name));
    return q.has(name) && Number.isFinite(v) && v >= min && v <= max ? v : null;
  };
  roomClock.bpm = num("bpm", 30, 240);
  roomClock.energy = num("energy", 0, 1);
  roomClock.valence = num("valence", 0, 1);
  roomClock.otherWeather = pick("otherweather", WEATHERS);
}
