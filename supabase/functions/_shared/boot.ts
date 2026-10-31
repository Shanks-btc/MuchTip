import { fail, logJson } from "./http.ts";

export type Handler = (req: Request) => Promise<Response>;

/**
 * Builds the handler on the first request instead of at module load, so a missing or malformed environment variable
 * answers with a JSON 500 ("misconfigured") rather than killing the function before it can serve anything.
 */
export function serveLazy(build: () => Handler, corsOrigin = Deno.env.get("CORS_ALLOW_ORIGIN") || "*"): void {
  let handler: Handler | undefined;
  Deno.serve((req) => {
    try {
      handler ??= build();
    } catch (e) {
      return fail(e, corsOrigin, logJson);
    }
    return handler(req);
  });
}
