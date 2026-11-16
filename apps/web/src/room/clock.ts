export const roomClock = { offset: 0, weather: null as string | null };

export const roomNow = () => new Date(Date.now() + roomClock.offset);

export function readClockParams() {
  const q = new URLSearchParams(window.location.search);
  const at = q.get("at");
  if (at) {
    const today = new Date();
    const hhmm = /^(\d{1,2}):(\d{2})$/.exec(at);
    const target = hhmm ? new Date(today.getFullYear(), today.getMonth(), today.getDate(), Number(hhmm[1]), Number(hhmm[2])) : new Date(at);
    if (!Number.isNaN(target.getTime())) roomClock.offset = target.getTime() - Date.now();
  }
  const w = q.get("weather");
  if (w && ["clear", "clouds", "fog", "drizzle", "rain", "snow", "thunderstorm"].includes(w)) roomClock.weather = w;
}
