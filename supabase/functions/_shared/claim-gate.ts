import { X_ID_RE } from "./ids.ts";

/** The part of a Supabase Auth user that the gate looks at. */
export interface AuthUserLike {
  is_anonymous?: boolean;
  identities?: Array<{ provider?: string; id?: string; identity_data?: Record<string, unknown> }> | null;
}

export type GateResult = { ok: true; xId: bigint; username: string | null } | { ok: false; reason: string };

const reject = (reason: string): GateResult => ({ ok: false, reason });

/**
 * Which X account may this caller claim for? Only a non-anonymous user whose identities are EXACTLY ONE and that one is
 * an 'x' identity. The id comes from `identities[0].id`, which Supabase Auth sets from X's own response and no client
 * route can edit. It never comes from `user_metadata` (user-writable) or `app_metadata`.
 *
 * Why exactly one: an account that also holds an email/phone/other identity can hold an X identity that belongs to
 * someone else (pre-registration takeover, see verified.md section 3d). TypeScript port of spike/supabase/edge-check.cjs.
 */
export function xIdFromUser(user: AuthUserLike | null | undefined): GateResult {
  if (!user) return reject("no user");
  if (user.is_anonymous) return reject("anonymous user");
  const identities = user.identities ?? [];
  if (identities.length !== 1) {
    return reject(`expected exactly 1 identity, found ${identities.length} (${identities.map((i) => i.provider).join(",") || "none"})`);
  }
  const [identity] = identities;
  if (identity.provider !== "x") return reject(`non-x identity: ${identity.provider}`);
  if (typeof identity.id !== "string" || !X_ID_RE.test(identity.id)) return reject("non-numeric X id");
  const sub = identity.identity_data?.sub;
  if (sub !== undefined && String(sub) !== identity.id) return reject("identity id and sub disagree");
  const username = identity.identity_data?.user_name;
  return { ok: true, xId: BigInt(identity.id), username: typeof username === "string" ? username : null };
}
