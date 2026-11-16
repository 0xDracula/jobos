export const hotspotElements = new Map<string, HTMLElement>();

export const roomView = { reveal: (id: string) => void id };

export function placeHotspots(anchor: (id: string) => { x: number; y: number } | null) {
  for (const [id, el] of hotspotElements) {
    const a = anchor(id);
    if (!a) {
      el.style.visibility = "hidden";
      continue;
    }
    el.style.visibility = "visible";
    el.style.transform = `translate(${Math.round(a.x)}px, ${Math.round(a.y)}px)`;
  }
}
