// The check an Edge Function runs on the caller before it signs an EIP-712 claim for them.
// Port this logic 1:1 into the Deno Edge Function (it only uses the user object GoTrue returns).
//
// Rule (hardened): the caller must be a non-anonymous user with EXACTLY ONE identity, and it must be an 'x' identity.
// Rejecting every other shape closes the "pre-registration" takeover, where an account that also holds an
// email/phone/other identity could hold an X identity that belongs to someone else.
//
// What it does NOT trust: user_metadata (user-writable). It reads identities[0].id, which GoTrue sets from X's own
// response and which no client route can edit (see ../../verified.md, section 3b).

const reject = (reason) => ({ ok: false, reason });

function xIdFromUser(user) {
  if (!user) return reject("no user");
  if (user.is_anonymous) return reject("anonymous user");
  const identities = user.identities ?? [];
  if (identities.length !== 1) {
    return reject(`expected exactly 1 identity, found ${identities.length} (${identities.map((i) => i.provider).join(",") || "none"})`);
  }
  const [identity] = identities;
  if (identity.provider !== "x") return reject(`non-x identity: ${identity.provider}`);
  if (!/^\d{1,20}$/.test(identity.id ?? "")) return reject(`non-numeric X id: ${identity.id}`);
  const sub = identity.identity_data?.sub;
  if (sub !== undefined && String(sub) !== identity.id) return reject("identity id and sub disagree");
  return { ok: true, xId: BigInt(identity.id), username: identity.identity_data?.user_name };
}

// `auth` is a GoTrue/supabase-js auth client. getUser(jwt) is a network call that validates signature, expiry and
// that the user still exists; nothing is decoded locally.
async function xIdFromJwt(auth, jwt) {
  const { data, error } = await auth.getUser(jwt);
  if (error || !data?.user) return reject(error?.message || "no user");
  return xIdFromUser(data.user);
}

module.exports = { xIdFromUser, xIdFromJwt };
