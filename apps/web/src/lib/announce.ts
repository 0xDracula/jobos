export function announce(text: string): void {
  const region = document.getElementById("live-region");
  if (!region) return;
  region.textContent = "";
  requestAnimationFrame(() => {
    region.textContent = text;
  });
}
