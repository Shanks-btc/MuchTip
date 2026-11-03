import { useSyncExternalStore } from "react";

/** True when the media query matches; updates on resize. Used where phone and desktop render different components. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}

/** The spec's phone layouts (P1–P4) apply under 640 px. */
export const usePhone = () => useMedia("(max-width: 639px)");
