/** An error that maps straight to an HTTP response: `{ "error": { "code", "message" } }`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export type Log = (entry: Record<string, unknown>) => void;

export function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "86400",
  };
}

export function json(status: number, body: unknown, origin: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...corsHeaders(origin), ...extra },
  });
}

export function preflight(origin: string): Response {
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

/** Turns anything thrown into a response. Unexpected errors are logged and reported as an opaque 500. */
export function fail(e: unknown, origin: string, log: Log): Response {
  if (e instanceof HttpError) return json(e.status, { error: { code: e.code, message: e.message } }, origin, e.headers);
  log({ event: "unhandled_error", message: e instanceof Error ? e.message : String(e) });
  return json(500, { error: { code: "internal", message: "Internal error" } }, origin);
}

export function clientIp(req: Request): string {
  const h = req.headers;
  return h.get("cf-connecting-ip") ?? h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}

export async function readJsonBody(req: Request, maxChars = 2048): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > maxChars) throw new HttpError(413, "body_too_large", "Request body too large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be a JSON object");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, "invalid_json", "Request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export const logJson: Log = (entry) => console.log(JSON.stringify(entry));
