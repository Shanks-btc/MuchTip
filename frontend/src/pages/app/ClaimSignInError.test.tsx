// @vitest-environment jsdom
// A failed "Sign in with X" returns to /app/claim?error=…&error_description=… (or #error=…): the Claim page must say so,
// show the reason, offer Try again, and take the error out of the URL.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthErrorRedirect } from "../../components/AuthErrorRedirect";
import { authErrorTarget, readAuthError, withoutAuthError } from "../../lib/authError";

vi.mock("../../env", () => ({
  ENV_ERRORS: [],
  ENV: { chainId: 6281971, rpcUrl: "https://rpc.testnet.dogeos.com/", explorerUrl: "https://blockscout.testnet.dogeos.com", escrowAddress: "0x207652b0767F9f19d24B5300E2123D415167aCeF", escrowDeployBlock: 9065839n, supabaseUrl: "https://t.supabase.co", supabaseAnonKey: "anon", functionsUrl: "https://t.supabase.co/functions/v1", reownProjectId: null, appOrigin: null },
}));
const signIn = vi.fn();
vi.mock("../../data/auth", () => ({
  useXSession: () => ({ ready: true, session: null, account: null, unsupportedIdentity: false, signIn, signOut: vi.fn() }),
}));
vi.mock("../../lib/useMedia", () => ({ usePhone: () => false }));

const { default: Claim } = await import("./Claim");

let current = "";
function Where() {
  const l = useLocation();
  current = `${l.pathname}${l.search}${l.hash}`;
  return null;
}
function renderAt(url: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[url]}>
        <Claim />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("reading the sign-in error from the URL", () => {
  it("reads the query, then the hash, and decodes the reason", () => {
    expect(readAuthError("?error=access_denied&error_code=bad_oauth_state&error_description=User+denied+access", "")).toEqual({ code: "bad_oauth_state", reason: "User denied access" });
    expect(readAuthError("", "#error=server_error&error_description=Error%20getting%20user%20email%20from%20external%20provider")).toEqual({ code: "server_error", reason: "Error getting user email from external provider" });
    expect(readAuthError("?error=access_denied", "")).toEqual({ code: "access_denied", reason: null });
    expect(readAuthError("?to=jack", "#faq")).toBeNull();
  });
  it("removes only the error parameters", () => {
    expect(withoutAuthError("/app/claim", "?error=access_denied&error_description=x&code=abc", "")).toBe("/app/claim?code=abc");
    expect(withoutAuthError("/app/claim", "", "#error=server_error&error_code=500&error_description=x")).toBe("/app/claim");
    expect(withoutAuthError("/app/claim", "?ref=x", "#faq")).toBe("/app/claim?ref=x#faq");
  });
});

describe("Claim page after a failed X sign-in", () => {
  it("shows the message and the reason, clears the URL, and Try again signs in again", async () => {
    renderAt("/app/claim?error=access_denied&error_code=access_denied&error_description=The+user+denied+the+request");
    expect(screen.getByText("Sign-in with X didn't complete. Please try again.")).toBeTruthy();
    expect(screen.getByText("The user denied the request (access_denied)")).toBeTruthy();
    await waitFor(() => expect(current).toBe("/app/claim"));
    // the message stays after the URL is cleaned, until the user acts on it
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Sign-in with X didn't complete. Please try again.")).toBeNull();
  });

  it("reads an error from the hash too", async () => {
    renderAt("/app/claim#error=server_error&error_description=Unable+to+exchange+external+code");
    expect(screen.getByText("Unable to exchange external code (server_error)")).toBeTruthy();
    await waitFor(() => expect(current).toBe("/app/claim"));
  });

  it("shows nothing when the URL has no error", () => {
    renderAt("/app/claim");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: /Sign in with X to claim/ })).toBeTruthy();
  });
});

describe("a sign-in error on any other page goes to Claim", () => {
  it("decides the target, keeping every parameter", () => {
    const q = "?error=access_denied&error_code=access_denied&error_description=The+user+denied+the+request";
    expect(authErrorTarget("/", q, "")).toBe(`/app/claim${q}`);
    expect(authErrorTarget("/app", "", "#error=server_error&error_description=x")).toBe("/app/claim#error=server_error&error_description=x");
    expect(authErrorTarget("/app/claim", q, "")).toBeNull(); // already there
    expect(authErrorTarget("/", "?to=jack", "#faq")).toBeNull(); // no error: stay
  });

  it("from the landing page (/?error=…), the Claim page shows the error and the URL ends clean", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/?error=access_denied&error_code=access_denied&error_description=The+user+denied+the+request"]}>
          <Routes>
            <Route element={<AuthErrorRedirect><Outlet /></AuthErrorRedirect>}>
              <Route path="/" element={<p>Landing page</p>} />
              <Route path="/app/claim" element={<Claim />} />
            </Route>
          </Routes>
          <Where />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Sign-in with X didn't complete. Please try again.")).toBeTruthy();
    expect(screen.getByText("The user denied the request (access_denied)")).toBeTruthy();
    expect(screen.queryByText("Landing page")).toBeNull();
    await waitFor(() => expect(current).toBe("/app/claim"));
  });
});
