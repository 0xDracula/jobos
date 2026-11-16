import { api } from "./api";
import { drop, load, save } from "./storage";

const KEY = "jobbos.device";

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

function os(ua: string): string {
  if (/Android/i.test(ua)) return "Android";
  if (isIOS()) return "iOS";
  if (/Mac OS X/i.test(ua)) return "macOS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/CrOS/i.test(ua)) return "ChromeOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "Unknown";
}

function browser(ua: string): string {
  if (/Edg\//.test(ua)) return "Edge";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/SamsungBrowser\//.test(ua)) return "Samsung Internet";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "Browser";
}

export function deviceName(): string {
  const ua = navigator.userAgent;
  return `${browser(ua)} on ${os(ua)}`;
}

function platform(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (isIOS()) return "ios";
  return "desktop";
}

export const knownDeviceId = (): string | null => load<string | null>(KEY, null);

let registration: Promise<string> | null = null;

export function deviceId(): Promise<string> {
  registration ??= register(knownDeviceId());
  return registration;
}

async function register(known: string | null): Promise<string> {
  try {
    const { id } = await api.registerDevice(known, deviceName(), platform());
    save(KEY, id);
    return id;
  } catch (err) {
    registration = null;
    if (known) return known;
    throw err;
  }
}

export function forgetDevice(): void {
  registration = null;
  drop(KEY);
}
