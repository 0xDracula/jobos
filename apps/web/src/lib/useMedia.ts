import { useSyncExternalStore } from "react";

export function useMedia(query: string, server = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => server,
  );
}

export const useDesktop = () => useMedia("(min-width: 1024px)");
