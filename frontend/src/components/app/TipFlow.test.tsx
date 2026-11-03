// @vitest-environment jsdom
// Wiring-spec 8.2: each S1 state of the send flow, with wagmi, the wallet/fee hooks and fetch mocked. Nothing here
// touches a network or a wallet.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BaseError, ContractFunctionRevertedError, encodeAbiParameters, encodeErrorResult, encodeEventTopics, parseEther, UserRejectedRequestError, type Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escrowAbi } from "../../chain/abi";

const ESCROW = "0x207652b0767F9f19d24B5300E2123D415167aCeF";
const ME = "0x1BE5DB49a70d633c6e6AF7900598118Fb65419AE";
const HASH = `0x${"ab".repeat(32)}` as Hex;
const X = { xId: "2244994945", handle: "XDevelopers", name: "X Developers", idHash: "0x9459c13b5c21e1f0cc54307300f50fe36658555fa2b2355575aa4d05c6f21914", source: "x" };

// the backend is configured in these tests (resolve goes through fetch, never the demo fixtures)
vi.mock("../../env", () => ({
  ENV_ERRORS: [],
  ENV: { chainId: 6281971, rpcUrl: "https://rpc.testnet.dogeos.com/", explorerUrl: "https://blockscout.testnet.dogeos.com", escrowAddress: ESCROW, escrowDeployBlock: 9065839n, supabaseUrl: "https://t.supabase.co", supabaseAnonKey: "anon", functionsUrl: "https://t.supabase.co/functions/v1", reownProjectId: null, appOrigin: "https://muchtip.test" },
}));

const state = {
  balance: parseEther("100"),
  fee: { aboutWei: parseEther("0.02"), upToWei: parseEther("0.03"), source: "oracle" as const },
};
const feeRefetch = vi.fn(async () => ({ data: state.fee }));
vi.mock("../../chain/hooks", () => ({
  useEscrowConfig: () => ({ minTipWei: parseEther("5"), refundDelaySeconds: 600, refundDelayText: "10 minutes", source: "chain", isError: false, refetch: vi.fn() }),
  useFeeQuote: () => ({ data: state.fee, refetch: feeRefetch }),
  useWallet: () => ({ status: "connected", address: ME, balanceWei: state.balance, refetchBalance: vi.fn() }),
}));
vi.mock("../ui/WalletButton", () => ({
  useConnectWallet: () => ({ connect: vi.fn(), isConnecting: false }),
  useSwitchToChikyu: () => ({ switchToChikyu: vi.fn(), isSwitching: false }),
}));

const client = {
  simulateContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  getBlock: vi.fn(async () => ({ timestamp: 1793456000n })),
  readContract: vi.fn(async () => 1793456600n), // refundableAt(tipId)
  request: vi.fn(async () => ({ l1Fee: "0x4dbc1b3b9c2780", gasUsed: "0x1d2a2", effectiveGasPrice: "0x11f1e0d" })),
  getTransaction: vi.fn(),
};
const writeContractAsync = vi.fn();
vi.mock("wagmi", () => ({ usePublicClient: () => client, useWriteContract: () => ({ writeContractAsync }) }));

const { TipFlow } = await import("./TipFlow");

function tippedReceipt(tipId: bigint) {
  const topics = encodeEventTopics({ abi: escrowAbi, eventName: "Tipped", args: { tipId, idHash: X.idHash as Hex, from: ME } });
  return {
    status: "success",
    blockNumber: 9_200_000n,
    from: ME,
    logs: [{ address: ESCROW.toLowerCase(), topics, data: encodeAbiParameters([{ type: "uint256" }], [parseEther("25")]), blockNumber: 9_200_000n, logIndex: 0, transactionHash: HASH }],
  };
}

function resolveWith(body: object, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })));
}

function renderFlow(props: { previewXId?: string | null; resumeHash?: Hex | null } = {}) {
  const onConfirmed = vi.fn();
  const onSubmitted = vi.fn();
  const onAmount = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <TipFlow handle="XDevelopers" amountText="25" note="Loved it" resumeHash={props.resumeHash ?? null} previewXId={props.previewXId ?? X.xId} onEdit={vi.fn()} onSubmitted={onSubmitted} onConfirmed={onConfirmed} onAmount={onAmount} onAnother={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onConfirmed, onSubmitted, onAmount };
}

beforeEach(() => {
  state.balance = parseEther("100");
  resolveWith(X);
  client.simulateContract.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("S1 send flow states", () => {
  it("1 review: fresh lookup, fee range, total, refund window, confirm enabled", async () => {
    renderFlow();
    expect(await screen.findByText(/X ID 2244994945/)).toBeTruthy();
    expect(screen.getByText("Review your tip")).toBeTruthy();
    expect(screen.getByText("25.00 DOGE")).toBeTruthy();
    expect(screen.getByText("25.03 DOGE")).toBeTruthy(); // amount + high, at most
    expect(screen.getByText("10 minutes")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Confirm in wallet" }) as HTMLButtonElement).disabled).toBe(false);
    // resolve was called with fresh=1 (W2.7)
    expect(String((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])).toContain("fresh=1");
  });

  it("asks again when the fresh X id differs from the preview (W2.7)", async () => {
    renderFlow({ previewXId: "12" });
    expect(await screen.findByText("@XDevelopers is now a different X account")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Confirm the account above first" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Tip this account" }));
    expect((screen.getByRole("button", { name: "Confirm in wallet" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("refuses to send when the id hash doesn't match the X id (W2.8)", async () => {
    resolveWith({ ...X, idHash: `0x${"11".repeat(32)}` });
    renderFlow();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm in wallet" }));
    expect(await screen.findByText("The lookup didn't check out")).toBeTruthy();
    expect(writeContractAsync).not.toHaveBeenCalled();
  });

  it("2 waiting for wallet, 3 submitted, 4 confirmed with the real fee and tipId", async () => {
    let sign!: (h: Hex) => void;
    writeContractAsync.mockReturnValue(new Promise<Hex>((r) => (sign = r)));
    let mine!: (r: unknown) => void;
    client.waitForTransactionReceipt.mockReturnValue(new Promise((r) => (mine = r)));
    const { onConfirmed, onSubmitted } = renderFlow();

    fireEvent.click(await screen.findByRole("button", { name: "Confirm in wallet" }));
    expect(await screen.findByText("Confirm in your wallet")).toBeTruthy();
    expect(feeRefetch).toHaveBeenCalled(); // one more quote right before sending
    expect(writeContractAsync).toHaveBeenCalledWith(expect.objectContaining({ functionName: "tip", args: [X.idHash], value: parseEther("25") }));

    await act(async () => sign(HASH));
    expect(await screen.findByText("Waiting for DogeOS")).toBeTruthy();
    expect(onSubmitted).toHaveBeenCalledWith(HASH);

    await act(async () => mine(tippedReceipt(7n)));
    expect(await screen.findByText("25 DOGE is waiting for @XDevelopers")).toBeTruthy();
    // l1Fee + gasUsed x effectiveGasPrice from the raw receipt = 0.021882646… DOGE, shown to 4 decimals
    expect(screen.getByText("0.0218 DOGE")).toBeTruthy();
    expect(onConfirmed).toHaveBeenCalledWith({ hash: HASH, time: 1793456000, tipId: 7n, refundAt: 1793456600, from: ME });
    expect(client.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "refundableAt", args: [7n] }));
    const share = screen.getByRole("link", { name: /Tell them on X/ }).getAttribute("href") ?? "";
    expect(share.startsWith("https://x.com/intent/tweet?")).toBe(true);
    expect(new URL(share).searchParams.get("text")).toBe('@XDevelopers I just tipped you 25 DOGE on MuchTip: "Loved it". Claim it with your X account: https://muchtip.test/app/claim');
  });

  it("a wallet rejection returns to review with the spec's copy", async () => {
    writeContractAsync.mockRejectedValue(new BaseError("x", { cause: new UserRejectedRequestError(new Error("User rejected the request.")) }));
    renderFlow();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm in wallet" }));
    expect(await screen.findByText("You cancelled in your wallet.")).toBeTruthy();
    expect(screen.getByText("Review your tip")).toBeTruthy();
  });

  it("5 failed: a revert is decoded to the spec's copy", async () => {
    const data = encodeErrorResult({ abi: escrowAbi, errorName: "BelowMinTip" });
    client.simulateContract.mockRejectedValue(new BaseError("reverted", { cause: new ContractFunctionRevertedError({ abi: escrowAbi, data, functionName: "tip" }) }));
    renderFlow();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm in wallet" }));
    expect(await screen.findByText("The tip didn't go through")).toBeTruthy();
    expect(screen.getByText("The minimum tip is 5 DOGE.")).toBeTruthy();
    expect(writeContractAsync).not.toHaveBeenCalled();
  });

  it("6 blocked: balance below amount + high, with 'Tip N DOGE instead'", async () => {
    state.balance = parseEther("20");
    const { onAmount } = renderFlow();
    expect(await screen.findByText("Not enough DOGE", { selector: "div" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tip 19 DOGE instead" }));
    expect(onAmount).toHaveBeenCalledWith("19");
  });

  it("a lookup error uses the spec's copy", async () => {
    resolveWith({ error: { code: "upstream_unavailable", message: "x" } }, 502);
    renderFlow();
    expect(await screen.findByText("We can't reach X right now. Try again shortly. Nothing was sent.")).toBeTruthy();
  });
});
