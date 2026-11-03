// @vitest-environment jsdom
// Wiring-spec W3 and 8.2: the claim flow with sign-claim (fetch), wagmi and the chain hooks mocked.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BaseError, ContractFunctionRevertedError, encodeErrorResult, parseEther, type Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escrowAbi } from "../../chain/abi";

const ESCROW = "0x207652b0767F9f19d24B5300E2123D415167aCeF";
const ME = "0x1BE5DB49a70d633c6e6AF7900598118Fb65419AE";
const HASH = `0x${"cd".repeat(32)}` as Hex;

vi.mock("../../env", () => ({
  ENV_ERRORS: [],
  ENV: { chainId: 6281971, rpcUrl: "https://rpc.testnet.dogeos.com/", explorerUrl: "https://blockscout.testnet.dogeos.com", escrowAddress: ESCROW, escrowDeployBlock: 9065839n, supabaseUrl: "https://t.supabase.co", supabaseAnonKey: "anon", functionsUrl: "https://t.supabase.co/functions/v1", reownProjectId: null, appOrigin: "https://muchtip.test" },
}));
vi.mock("../../data/auth", () => ({
  useXSession: () => ({ ready: true, session: { access_token: "jwt" }, account: { xId: "2244994945", handle: "XDevelopers", name: "X Developers" }, unsupportedIdentity: false, signIn: vi.fn(), signOut: vi.fn() }),
}));

const summary = {
  readyWei: parseEther("10") as bigint | undefined,
  pending: [{ id: 3n, idHash: "0x9459c13b5c21e1f0cc54307300f50fe36658555fa2b2355575aa4d05c6f21914", tipper: ME, createdAt: 1793456000, amountWei: parseEther("10"), status: "Pending", refundableAt: 1793456600 }],
  loading: false,
  claimedWei: 0n,
  claimedCount: 0,
  txOfTip: new Map(),
  syncing: false,
  refetch: vi.fn(async () => undefined),
};
vi.mock("../../chain/hooks", () => ({
  useClaimSummary: () => summary,
  useFeeQuote: () => ({ data: { aboutWei: parseEther("0.04"), upToWei: parseEther("0.06"), source: "oracle" } }),
  useNow: () => 1793456100,
  useWallet: () => ({ status: "connected", address: ME, balanceWei: parseEther("3"), refetchBalance: vi.fn() }),
}));
vi.mock("../../components/ui/WalletButton", () => ({
  useConnectWallet: () => ({ connect: vi.fn(), isConnecting: false }),
  useSwitchToChikyu: () => ({ switchToChikyu: vi.fn(), isSwitching: false }),
}));
vi.mock("../../lib/useMedia", () => ({ usePhone: () => false }));

const client = {
  simulateContract: vi.fn(async () => ({})),
  waitForTransactionReceipt: vi.fn(),
  getTransaction: vi.fn(),
  request: vi.fn(async () => ({ l1Fee: "0x7cdbd0cd4d6e00", gasUsed: "0x1cfe0", effectiveGasPrice: "0x11f1e0d" })),
};
const writeContractAsync = vi.fn(async () => HASH);
vi.mock("wagmi", () => ({ usePublicClient: () => client, useWriteContract: () => ({ writeContractAsync }) }));

const { default: Claim } = await import("./Claim");

const signed = (over: object = {}) => ({ xId: "2244994945", handle: "XDevelopers", recipient: ME, nonce: "8812", expiry: "1793456400", signature: `0x${"11".repeat(65)}`, digest: "0x", contract: ESCROW, chainId: 6281971, unclaimedWei: "10000000000000000000", claimable: true, ...over });
const fetchMock = vi.fn();

function renderClaim() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Claim />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const expiredRevert = () => new BaseError("reverted", { cause: new ContractFunctionRevertedError({ abi: escrowAbi, data: encodeErrorResult({ abi: escrowAbi, errorName: "Expired" }), functionName: "claim" }) });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  summary.syncing = false;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("Claim (W3)", () => {
  it("sends the session token and the connected wallet to sign-claim, then claims with BigInt args", async () => {
    fetchMock.mockResolvedValueOnce(json(signed()));
    client.waitForTransactionReceipt.mockResolvedValueOnce({ status: "success", blockNumber: 9_200_001n });
    renderClaim();
    fireEvent.click(await screen.findByRole("button", { name: "Claim all, one transaction" }));
    expect(await screen.findByText("10 DOGE claimed.")).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://t.supabase.co/functions/v1/sign-claim");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer jwt");
    expect(JSON.parse(String(init.body))).toEqual({ recipient: ME });
    expect(writeContractAsync).toHaveBeenCalledWith(expect.objectContaining({ functionName: "claim", args: [2244994945n, ME, 8812n, 1793456400n, `0x${"11".repeat(65)}`] }));
    expect(screen.getByText(/fee 0\.0351 DOGE/)).toBeTruthy(); // real fee from the raw receipt
  });

  it("fetches a new signature and retries once when the claim expired", async () => {
    fetchMock.mockResolvedValueOnce(json(signed({ nonce: "1" }))).mockResolvedValueOnce(json(signed({ nonce: "2" })));
    client.simulateContract.mockRejectedValueOnce(expiredRevert()).mockResolvedValueOnce({});
    client.waitForTransactionReceipt.mockResolvedValueOnce({ status: "success", blockNumber: 9_200_002n });
    renderClaim();
    fireEvent.click(await screen.findByRole("button", { name: "Claim all, one transaction" }));
    expect(await screen.findByText("10 DOGE claimed.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(writeContractAsync).toHaveBeenCalledTimes(1);
    expect(writeContractAsync).toHaveBeenCalledWith(expect.objectContaining({ args: expect.arrayContaining([2n]) }));
  });

  it("gives up after one retry, with the spec's copy", async () => {
    fetchMock.mockImplementation(async () => json(signed())); // a fresh Response per call (a body can only be read once)
    client.simulateContract.mockRejectedValue(expiredRevert());
    renderClaim();
    fireEvent.click(await screen.findByRole("button", { name: "Claim all, one transaction" }));
    expect(await screen.findByText("That claim took too long. Try again.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says 'Nothing to claim yet' when sign-claim reports nothing claimable", async () => {
    fetchMock.mockResolvedValueOnce(json(signed({ claimable: false, unclaimedWei: "0" })));
    renderClaim();
    fireEvent.click(await screen.findByRole("button", { name: "Claim all, one transaction" }));
    expect(await screen.findByText("Nothing to claim yet")).toBeTruthy();
    expect(writeContractAsync).not.toHaveBeenCalled();
  });

  it("an expired X session asks to sign in again", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { code: "invalid_token", message: "x" } }, 401));
    renderClaim();
    fireEvent.click(await screen.findByRole("button", { name: "Claim all, one transaction" }));
    expect(await screen.findByText("Your X sign-in expired. Sign in again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in again" })).toBeTruthy();
  });

  it("a lagging index shows 'still syncing' instead of a wrong list", async () => {
    summary.syncing = true;
    renderClaim();
    expect(await screen.findByText(/Some tips are still syncing/)).toBeTruthy();
  });

  it("the tip page link is {origin}/app?to={handle}", async () => {
    renderClaim();
    expect(await screen.findByText("muchtip.test/app?to=XDevelopers")).toBeTruthy();
  });
});
