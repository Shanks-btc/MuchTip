import { HttpError } from "./http.ts";

export interface RateLimiter {
  /** Counts one hit; resolves true while the caller is within `limit` hits per `windowSeconds`. */
  hit(bucket: string, windowSeconds: number, limit: number): Promise<boolean>;
}

/**
 * Throws 429 when over the limit and 503 when the limiter itself is unavailable. It fails closed on purpose: the
 * limiter protects paid X API calls and signature issuance.
 */
export async function enforce(rl: RateLimiter, bucket: string, windowSeconds: number, limit: number): Promise<void> {
  let allowed: boolean;
  try {
    allowed = await rl.hit(bucket, windowSeconds, limit);
  } catch {
    throw new HttpError(503, "rate_limit_unavailable", "Temporarily unavailable, try again shortly", { "retry-after": "10" });
  }
  if (!allowed) throw new HttpError(429, "rate_limited", "Too many requests, slow down", { "retry-after": String(windowSeconds) });
}

/** Buckets hold a hash of the client IP, never the address itself. */
export async function ipBucket(prefix: string, ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  const hex = Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}:ip:${hex}`;
}
