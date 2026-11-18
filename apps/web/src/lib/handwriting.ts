export const HAND_UNICODE_RANGE = "U+0000-05FF, U+0700-074F, U+0780-086F, U+0900-FB4F, U+FE00-FE6F, U+FF00-10FFFF";

export const HAND_FALLBACK = "var(--stack-hand, cursive)";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FONT_URL = /^\/api\/fonts\/[0-9a-f]{64}\.woff2$/;

export type FontSource = { user_id: string; url: string | null; status: string };

export const handFamilyName = (userId: string) => `jobbos-hand-${userId}`;

export function readyFonts(fonts: FontSource[] | undefined): Set<string> {
  return new Set((fonts ?? []).filter((f) => f.status === "ready" && f.url && FONT_URL.test(f.url) && UUID.test(f.user_id)).map((f) => f.user_id));
}

export function handFontFamily(userId: string | null | undefined, ready: ReadonlySet<string>): string {
  return userId && ready.has(userId) ? `"${handFamilyName(userId)}", ${HAND_FALLBACK}` : HAND_FALLBACK;
}

export function fontFaceCss(fonts: FontSource[] | undefined): string {
  const ready = readyFonts(fonts);
  return (fonts ?? [])
    .filter((f) => ready.has(f.user_id))
    .map(
      (f) =>
        `@font-face{font-family:"${handFamilyName(f.user_id)}";src:url("${f.url}") format("woff2");font-display:swap;unicode-range:${HAND_UNICODE_RANGE};}`,
    )
    .join("\n");
}

export function coveredByUpload(codePoint: number): boolean {
  return HAND_UNICODE_RANGE.split(",").some((part) => {
    const [from, to] = part.trim().slice(2).split("-").map((h) => parseInt(h, 16));
    return codePoint >= from && codePoint <= (to ?? from);
  });
}
