import { describe, expect, it, vi } from "vitest";
import { BaseError, UserRejectedRequestError } from "viem";
import { ConnectTimeout, connectErrorMessage, NO_WALLET, withTimeout } from "./WalletButton";

describe("wallet connect never spins forever", () => {
  it("names each failure the way the user can act on it", () => {
    expect(connectErrorMessage({ code: -32002, message: "Request of type 'wallet_requestPermissions' already pending" })).toMatch(/already has a connection request open/);
    expect(connectErrorMessage(new Error("Request of type 'eth_requestAccounts' already pending for origin"))).toMatch(/already has a connection request open/);
    expect(connectErrorMessage({ code: 4001, message: "x" })).toBe("You cancelled in your wallet.");
    expect(connectErrorMessage(new BaseError("x", { cause: new UserRejectedRequestError(new Error("User rejected the request.")) }))).toBe("You cancelled in your wallet.");
    expect(connectErrorMessage(new ConnectTimeout())).toMatch(/didn't answer.*unlock it, then try again/);
    expect(connectErrorMessage(new Error("boom"))).toBe("Couldn't connect the wallet. Try again.");
    expect(NO_WALLET).toMatch(/No wallet found/);
  });

  it("gives up on a request the wallet never answers, and passes real answers through", async () => {
    vi.useFakeTimers();
    const never = withTimeout(new Promise(() => {}), 30_000);
    const caught = never.catch((e) => e);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await caught).toBeInstanceOf(ConnectTimeout);
    vi.useRealTimers();
    await expect(withTimeout(Promise.resolve("ok"), 30_000)).resolves.toBe("ok");
    await expect(withTimeout(Promise.reject({ code: 4001 }), 30_000)).rejects.toEqual({ code: 4001 });
  });
});
