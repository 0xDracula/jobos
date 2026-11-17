export type EffectName = "hearts" | "confetti" | "sparkles" | "stars";

const NAMES: EffectName[] = ["hearts", "confetti", "sparkles", "stars"];
const isEffect = (s: string): s is EffectName => (NAMES as string[]).includes(s);

export const effectListeners = new Set<(e: EffectName) => void>();

export function playEffect(name: string) {
  if (!isEffect(name) || reducedMotion()) return;
  effectListeners.forEach((fn) => fn(name));
}

function reducedMotion(): boolean {
  if (typeof document === "undefined") return true;
  const pref = document.documentElement.dataset.motion;
  return pref === "reduced" || (pref !== "full" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

const strip = (s: string) => s.replace(/️/g, "").trim();

export function effectOf(body: string, effects: Record<string, string> | undefined): EffectName | null {
  if (!effects || !body) return null;
  const text = strip(body);
  for (const [emoji, name] of Object.entries(effects)) if (strip(emoji) === text && isEffect(name)) return name;
  return null;
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|⃣|[#*0-9])+$/u;

export function jumboEmoji(body: string): boolean {
  const text = body.replace(/\s+/g, "");
  if (!text || text.length > 40 || !EMOJI_ONLY.test(text) || /^[#*0-9]+$/.test(text)) return false;
  const count = typeof Intl !== "undefined" && "Segmenter" in Intl ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].length : 1;
  return count <= 3;
}

