// idHash -> handle, remembered in this browser when the user tips someone, so /me can show "@handle" instead of a hash.
// A per-viewer convenience only (the chain stores ids, not handles); every read and write is guarded.
const KEY = "muchtip.handles.v1";

function read(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function rememberHandle(idHash: string, handle: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), [idHash.toLowerCase()]: handle }));
  } catch {
    /* storage unavailable: the page falls back to the id hash */
  }
}

export const handleFor = (idHash: string): string | null => read()[idHash.toLowerCase()] ?? null;
