// The exact PostgREST requests the indexed reads send (W3.3, W4.1), with fetch mocked. The schema they target is
// supabase/migrations/20261031000003_chain_events.sql: lowercase contract / id_hash / account, amount_wei numeric.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../env", () => ({
  ENV_ERRORS: [],
  ENV: { chainId: 6281971, rpcUrl: "https://rpc.testnet.dogeos.com/", explorerUrl: "https://blockscout.testnet.dogeos.com", escrowAddress: "0x207652b0767F9f19d24B5300E2123D415167aCeF", escrowDeployBlock: 9065839n, supabaseUrl: "https://t.supabase.co", supabaseAnonKey: "anon", functionsUrl: "https://t.supabase.co/functions/v1", reownProjectId: null, appOrigin: null },
}));

const { tipsBy, tipsFor, handlesFor } = await import("./events");

const ID = "0x9459C13B5C21E1F0CC54307300F50FE36658555FA2B2355575AA4D05C6F21914";
const row = { block_number: 9200000, log_index: 0, tx_hash: `0x${"ab".repeat(32)}`, id_hash: ID.toLowerCase(), tip_id: "7", account: "0x1be5db49a70d633c6e6af7900598118fb65419ae", amount_wei: "123456789012345678901", block_time: "2026-11-02T10:00:00+00:00" };

function capture(body: unknown) {
  const calls: URL[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    calls.push(new URL(String(input instanceof Request ? input.url : input)));
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("chain_events reads", () => {
  it("tips for an X account: Tipped, lowercase filters, amount cast to text and parsed with BigInt", async () => {
    const calls = capture([row]);
    const tips = await tipsFor(ID);
    const q = calls[0];
    expect(q.pathname).toBe("/rest/v1/chain_events");
    expect(q.searchParams.get("select")).toContain("amount_wei::text");
    expect(q.searchParams.get("contract")).toBe("eq.0x207652b0767f9f19d24b5300e2123d415167acef");
    expect(q.searchParams.get("event")).toBe("eq.Tipped");
    expect(q.searchParams.get("id_hash")).toBe(`eq.${ID.toLowerCase()}`);
    expect(q.searchParams.get("order")).toBe("block_number.desc,log_index.desc");
    // above 2^53: exact only because it never became a JS number
    expect(tips[0]).toMatchObject({ tipId: 7n, amountWei: 123456789012345678901n, time: Date.parse("2026-11-02T10:00:00Z") / 1000 });
  });

  it("tips by a wallet: account filter and pages of 20 (asks for 21 to know if there is a next page)", async () => {
    const calls = capture(Array.from({ length: 21 }, (_, i) => ({ ...row, tip_id: String(i + 1) })));
    const page = await tipsBy("0x1BE5DB49a70d633c6e6AF7900598118Fb65419AE", 1);
    expect(calls[0].searchParams.get("account")).toBe("eq.0x1be5db49a70d633c6e6af7900598118fb65419ae");
    expect(calls[0].searchParams.get("offset")).toBe("20");
    expect(calls[0].searchParams.get("limit")).toBe("21");
    expect(page.rows).toHaveLength(20);
    expect(page.hasMore).toBe(true);
  });

  it("handles come from x_handles by id_hash, skipping reassigned (null) handles", async () => {
    const calls = capture([{ id_hash: ID.toLowerCase(), handle: "XDevelopers" }, { id_hash: "0x00", handle: null }]);
    const m = await handlesFor([ID, ID]);
    expect(calls[0].pathname).toBe("/rest/v1/x_handles");
    expect(calls[0].searchParams.get("id_hash")).toBe(`in.(${ID.toLowerCase()})`);
    expect([...m]).toEqual([[ID.toLowerCase(), "XDevelopers"]]);
  });
});
