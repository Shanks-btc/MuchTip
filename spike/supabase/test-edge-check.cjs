// Table test of the claim-signing gate (edge-check.cjs) on user objects shaped like GoTrue's, no Docker needed.
//   node test-edge-check.cjs
// Covers the shapes the live GoTrue harness (test-hardening.cjs) cannot produce: a phone identity (no SMS provider
// in the harness) and an x + x account (GoTrue would not create one). The live harness covers email, anonymous and
// email + x against a real server. Rule: not anonymous, EXACTLY one identity, and it is an 'x' identity.
const { xIdFromUser } = require("./edge-check.cjs");

const ident = (provider, id, extra = {}) => ({ provider, id, identity_data: { sub: id }, ...extra });
const X = ident("x", "2244994945");

const cases = [
  // [label, user, expected]
  ["one x identity", { identities: [X] }, { ok: true, xId: 2244994945n }],
  ["19-digit id above 2^53 stays exact", { identities: [ident("x", "1850123456789012345")] }, { ok: true, xId: 1850123456789012345n }],
  ["no user", null, { ok: false }],
  ["no identities", { identities: [] }, { ok: false }],
  ["identities missing", {}, { ok: false }],
  ["email identity only", { identities: [ident("email", "u1")] }, { ok: false }],
  ["phone identity only", { identities: [ident("phone", "u1")] }, { ok: false }],
  ["other OAuth provider only (github)", { identities: [ident("github", "2244994945")] }, { ok: false }],
  ["x + email", { identities: [X, ident("email", "u1")] }, { ok: false }],
  ["email + x (order reversed)", { identities: [ident("email", "u1"), X] }, { ok: false }],
  ["x + phone", { identities: [X, ident("phone", "u1")] }, { ok: false }],
  ["x + github", { identities: [X, ident("github", "99")] }, { ok: false }],
  ["x + x (two different X accounts)", { identities: [X, ident("x", "1850123456789012345")] }, { ok: false }],
  ["x + x (same id twice)", { identities: [X, X] }, { ok: false }],
  ["anonymous user", { is_anonymous: true, identities: [] }, { ok: false }],
  ["anonymous flag set on an x identity", { is_anonymous: true, identities: [X] }, { ok: false }],
  ["non-numeric id", { identities: [ident("x", "abc")] }, { ok: false }],
  ["negative id", { identities: [ident("x", "-5")] }, { ok: false }],
  ["id longer than 20 digits", { identities: [ident("x", "1".repeat(21))] }, { ok: false }],
  ["id and sub disagree", { identities: [{ provider: "x", id: "2244994945", identity_data: { sub: "999" } }] }, { ok: false }],
  ["x id only in user_metadata (user-writable), provider email", { identities: [ident("email", "u1")], user_metadata: { sub: "2244994945", provider_id: "2244994945" } }, { ok: false }],
  ["user_metadata claims a different id than the identity", { identities: [X], user_metadata: { sub: "1", provider_id: "1" } }, { ok: true, xId: 2244994945n }],
];

let failures = 0;
for (const [label, user, want] of cases) {
  const got = xIdFromUser(user);
  const pass = got.ok === want.ok && (!want.ok || got.xId === want.xId);
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(58)} ${got.ok ? "accepted xId=" + got.xId : "rejected: " + got.reason}`);
}
console.log(`\n${failures === 0 ? `ALL ${cases.length} CASES PASSED` : failures + " CASE(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
