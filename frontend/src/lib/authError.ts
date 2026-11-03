// A failed "Sign in with X" comes back to /app/claim with the reason in the URL: in the query
// (?error=access_denied&error_code=…&error_description=…) or, for the implicit flow, in the hash (#error=…).

export interface AuthRedirectError {
  /** e.g. "access_denied", "server_error" */
  code: string;
  /** X's or Supabase's own explanation, if any (untrusted text: render as text only) */
  reason: string | null;
}

const KEYS = ["error", "error_code", "error_description"];

const params = (s: string) => new URLSearchParams(s.replace(/^[?#]/, ""));

/** The sign-in error carried by a URL's query or hash, or null. The query wins if both have one. */
export function readAuthError(search: string, hash: string): AuthRedirectError | null {
  for (const p of [params(search), params(hash)]) {
    const error = p.get("error");
    const description = p.get("error_description");
    if (!error && !description) continue;
    const reason = description?.trim().slice(0, 200) || null;
    return { code: p.get("error_code") || error || "unknown_error", reason };
  }
  return null;
}

/** The same URL without the error parameters (everything else, e.g. a sign-in code, is kept). */
export function withoutAuthError(pathname: string, search: string, hash: string): string {
  // only a part that carries an error key is rewritten, so a plain anchor like #faq survives untouched
  const strip = (s: string) => {
    const p = params(s);
    if (!KEYS.some((k) => p.has(k))) return s.replace(/^[?#]/, "");
    KEYS.forEach((k) => p.delete(k));
    return p.toString();
  };
  const q = strip(search);
  const h = strip(hash);
  return `${pathname}${q ? `?${q}` : ""}${h ? `#${h}` : ""}`;
}
