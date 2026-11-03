// Every SAMPLE value the UI shows, in one place (no component holds example data).
//
// Two kinds:
//  - DEMO: stands in for the backend in DEVELOPMENT builds while it isn't configured (src/data/api.ts `demoMode`),
//    always labelled "Example data" / "Demo lookup". Production builds never use it (wiring-spec W4.2).
//  - ILLUSTRATION: fixed by the design spec (K1 hero phones, the H1 sample receipt, form placeholders), labelled as
//    samples where they appear (wiring-spec section 5). Not data; never shown as live.
// (The marketing figures that used to live here now come from real sources: the test count from ../test at build time,
// and the faucet sentence has no number.)
//
// Live values (wallet, contract reads incl. refundDelay() and minTip(), resolve, sign-claim, feed()) are NOT here; they
// come from src/chain/hooks.ts and src/data/hooks.ts.
import type { FeedEvent, FeedResponse } from "./types";

// ─── DEMO: activity feed ───────────────────────────────────────────────────────────────────────────────────────────
// TODO(backend): remove when VITE_SUPABASE_URL is set in every deployment; useFeed() then always calls feed().
// These are the six real events of the e2e run against the throwaway TEST contract (e2e-result.json, verified.md 6a),
// not the live contract: hashes, blocks and amounts are real, the times are those blocks' timestamps on Chikyū.
// The totals are what feed() returned for them in the integration test (docs/backend.md, "Tests").
export const DEMO_CONTRACT = "0xC48AAb30478bF9427428F62f04853b25Ca703986";
const TIPPER = "0x1BE5DB49a70d633c6e6AF7900598118Fb65419AE";
const RECIPIENT = "0x7B7b2504790280e9Bf050429FA03B25C6A8d226d";
const A = { idHash: "0x9459c13b5c21e1f0cc54307300f50fe36658555fa2b2355575aa4d05c6f21914", handle: "XDevelopers", xId: "2244994945" };
const B = { idHash: "0x0a7661b5bdf38e473300c54a5c4bf450a80dc3ae946e9f62944c5cbec744d8fa", handle: "MuchTipDemo", xId: "1850123456789012345" };
const CENT = "10000000000000000"; // 0.01 DOGE, the test contract's minimum

const events: FeedEvent[] = [
  { type: "Claimed", blockNumber: 9065879, logIndex: 0, txHash: "0x06fda845730bdc4246e004be5c31a4bcb5500dc7dfe4d6b1fe897bbc32624d34", time: "2026-10-31T13:17:12.000Z", ...A, amountWei: CENT, recipient: RECIPIENT },
  { type: "Tipped", blockNumber: 9065874, logIndex: 0, txHash: "0x87dff1dbd89fe4d2bedf84795d7fdafe1fbf7832060acba91e01eaaf617dfb83", time: "2026-10-31T13:16:57.000Z", ...A, amountWei: CENT, tipId: "3", from: TIPPER },
  { type: "Refunded", blockNumber: 9065871, logIndex: 0, txHash: "0xe011ef556d8556a0b9bd5ea1349771af0f64cf9b72806f8a229cee00df177ff8", time: "2026-10-31T13:16:48.000Z", ...B, amountWei: CENT, tipId: "2", tipper: TIPPER },
  { type: "Tipped", blockNumber: 9065853, logIndex: 0, txHash: "0x1d681b4317d26576db25766c7ef2237251d180535fea4085dc43c1063ed05a77", time: "2026-10-31T13:15:54.000Z", ...B, amountWei: CENT, tipId: "2", from: TIPPER },
  { type: "Claimed", blockNumber: 9065851, logIndex: 0, txHash: "0xa0c9003fea4f70bc928ede08718e69d7e5950fb7dcdd0db7d927d74e6629d08a", time: "2026-10-31T13:15:48.000Z", ...A, amountWei: CENT, recipient: RECIPIENT },
  { type: "Tipped", blockNumber: 9065848, logIndex: 0, txHash: "0x62cab35312b3e66a8cf99a00fc5b1a45e88d48bf492490164957c60d08849899", time: "2026-10-31T13:15:39.000Z", ...A, amountWei: CENT, tipId: "1", from: TIPPER },
];

export const demoFeed: FeedResponse = {
  contract: DEMO_CONTRACT,
  chainId: 6281971,
  config: null,
  sync: { headBlock: null, indexedToBlock: 9065879, lagBlocks: null, complete: true },
  totals: { tipsCount: 3, totalTippedWei: "30000000000000000", uniqueHandles: 2, unclaimedWei: "0", claimedWei: "20000000000000000", refundedWei: "10000000000000000", claimsCount: 2, refundsCount: 1 },
  onChain: null,
  events,
};

// ─── DEMO: handle lookups ──────────────────────────────────────────────────────────────────────────────────────────
// TODO(backend): remove with the demo feed; resolveHandle() then always asks resolve.
// The backend's own mock-mode fixtures (supabase/functions/_shared/x-api.ts MOCK_FIXTURES), so a demo answer here is
// exactly what an undeployed backend would give. XDevelopers, jack and elonmusk are the real X ids.
export const DEMO_ACCOUNTS: Record<string, { xId: string; handle: string; name: string }> = {
  xdevelopers: { xId: "2244994945", handle: "XDevelopers", name: "X Developers" },
  jack: { xId: "12", handle: "jack", name: "jack" },
  elonmusk: { xId: "44196397", handle: "elonmusk", name: "Elon Musk" },
  muchtipdemo: { xId: "1850123456789012345", handle: "MuchTipDemo", name: "MuchTip Demo" },
  doge_fan_42: { xId: "710000042", handle: "Doge_Fan_42", name: "Doge Fan" },
};

// ─── ILLUSTRATION: hero phones (spec K1) ───────────────────────────────────────────────────────────────────────────
// Three SAMPLE personas, fixed by the spec. A static marketing illustration labelled on the page ("Sample accounts shown
// for illustration"). Not a TODO: the spec says these stay static.
export type PersonaTile = { tone: string; icon: "clock" | "refund" | "check" | "people"; value: string; label: string };
export interface Persona {
  name: string;
  initial: string;
  avatar: string;
  role: string;
  tabRole: string;
  blurb: string;
  aria: string;
  card: { label: string; chip: string; chipGold: boolean; whole: string; cents: string; caption: string; actions: [string, string, string] };
  tiles: [PersonaTile, PersonaTile, PersonaTile];
  feature: { tone: string; label: string; title: string; chips: [string, string] };
  list: { title: string; rows: [string, string][] };
  /** Which bottom-nav icon is active: 0 Send, 1 Claim, 2 My tips, 3 Activity. */
  nav: 0 | 1 | 2;
}

export const PERSONAS: Persona[] = [
  {
    name: "Ada", initial: "A", avatar: "bg-gold text-ink", role: "Fan · sends tips", tabRole: "Fan",
    blurb: "Ada tips the builders she follows. Each tip shows as waiting, claimed or refundable.",
    aria: "Show Ada, a fan who sends tips",
    card: { label: "YOUR BALANCE", chip: "CHIKYŪ", chipGold: false, whole: "1,240", cents: ".50", caption: "Tipped 6 people this week", actions: ["Send tip", "Receipts", "Refunds"] },
    tiles: [
      { tone: "bg-tile-waiting", icon: "clock", value: "3", label: "Waiting" },
      { tone: "bg-tile-refund", icon: "refund", value: "1", label: "Refundable" },
      { tone: "bg-tile-claimed", icon: "check", value: "11", label: "Claimed" },
    ],
    feature: { tone: "bg-tile-info", label: "LAST TIP · 2 MIN AGO", title: "25 DOGE to @shibe_builds", chips: ["HELD IN ESCROW", "REFUND 13:34"] },
    list: { title: "Recent", rows: [["@such_artist claimed", "50"], ["@wowlabs waiting", "69"]] },
    nav: 0,
  },
  {
    name: "Leo", initial: "L", avatar: "bg-ink text-gold", role: "Creator · gets tipped", tabRole: "Creator",
    blurb: "Leo signs in with X and claims every waiting tip in one transaction.",
    aria: "Show Leo, a creator who gets tipped",
    card: { label: "WAITING FOR YOU", chip: "3 TIPS", chipGold: true, whole: "99", cents: ".00", caption: "Claim everything in one transaction", actions: ["Claim all", "Share link", "History"] },
    tiles: [
      { tone: "bg-tile-claimed", icon: "check", value: "420", label: "Claimed" },
      { tone: "bg-tile-people", icon: "people", value: "14", label: "Tippers" },
      { tone: "bg-tile-waiting", icon: "clock", value: "6d", label: "Before refunds" },
    ],
    feature: { tone: "bg-tile-waiting", label: "YOUR TIP PAGE", title: "Share it so fans can tip you", chips: ["COPY LINK", "POST ON X"] },
    list: { title: "Tips for you", rows: [["from 0x1BE5…19AE", "69"], ["from 0x9C02…7a11", "25"]] },
    nav: 1,
  },
  {
    name: "Mia", initial: "M", avatar: "bg-tile-claimed text-ink", role: "Community lead", tabRole: "Community lead",
    blurb: "Mia thanks helpers in bulk. Anything unclaimed comes back to her.",
    aria: "Show Mia, a community lead",
    card: { label: "SENT THIS MONTH", chip: "37 HELPERS", chipGold: false, whole: "2,180", cents: ".00", caption: "Thanked 37 helpers across 2 servers", actions: ["Tip helpers", "Refunds", "Export"] },
    tiles: [
      { tone: "bg-tile-claimed", icon: "check", value: "35", label: "Claimed" },
      { tone: "bg-tile-refund", icon: "refund", value: "2", label: "Refundable" },
      { tone: "bg-tile-people", icon: "people", value: "37", label: "Helpers" },
    ],
    feature: { tone: "bg-tile-refund", label: "REFUND READY", title: "50 DOGE unclaimed for 7 days", chips: ["1 TAP", "BACK TO YOU"] },
    list: { title: "This week", rows: [["12 tips sent", "480"], ["10 claimed", "400"]] },
    nav: 2,
  },
];

// ─── ILLUSTRATION: form defaults and placeholders (spec A1) ────────────────────────────────────────────────────────
/** Placeholder of the Send note field, also shown greyed on the draft receipt. */
export const NOTE_PLACEHOLDER = "Loved your thread on DogeOS";
/** Preset selected when Send opens without ?amount= (spec A1 shows 25). */
export const DEFAULT_AMOUNT = "25";

// ─── ILLUSTRATION: the How it works receipt (spec H1, wiring-spec section 5: static, labelled "Sample receipt") ───
// The values of frame H1. The transaction is a real Tipped event from the e2e run (e2e-result.json); the refund time
// is computed from the live refundDelay(), so the sample never contradicts the contract.
export const SAMPLE_RECEIPT = {
  amountWei: 25_000_000_000_000_000_000n,
  from: "0x1BE5DB49a70d633c6e6AF7900598118Fb65419AE",
  to: "@shibe_builds",
  /** shown as "Sent 13:24" in the viewer's time zone */
  sentAt: { hours: 13, minutes: 24 },
  txHash: "0x62cab35312b3e66a8cf99a00fc5b1a45e88d48bf492490164957c60d08849899" as `0x${string}`,
};

// ─── FEE QUOTES: representative calls ──────────────────────────────────────────────────────────────────────────────
// The L1 data fee depends on a transaction's size, not its values, so quotes are built from these stand-ins until the
// real recipient is known. Never shown to the user.
export const QUOTE_SAMPLE = {
  /** idHash used before a handle has been looked up */
  idHash: `0x${"11".repeat(32)}` as `0x${string}`,
  tipDoge: "25",
  claim: { xId: 2244994945n, recipient: "0x1111111111111111111111111111111111111111" as `0x${string}`, nonce: 2n ** 255n, expiry: 2n ** 31n, signature: `0x${"22".repeat(65)}` as `0x${string}` },
};
