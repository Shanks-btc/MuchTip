// @vitest-environment jsdom
// Wiring-spec W4.1 (My tips status mapping) and W4.2 (feed chip states).
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { tipPillOf } from "../../chain/hooks";
import type { FeedResponse } from "../../data/types";
import { FeedChip, TIP_PILL } from "./Badge";

afterEach(cleanup);

describe("My tips status (W4.1)", () => {
  const at = 1000;
  it("maps chain status and the refund time to the four rows", () => {
    expect(tipPillOf({ status: "Pending", refundableAt: at }, at - 1)).toBe("waiting");
    expect(tipPillOf({ status: "Pending", refundableAt: at }, at)).toBe("refundable"); // refund(tipId) is allowed from refundableAt on
    expect(tipPillOf({ status: "Claimed", refundableAt: at }, at + 999)).toBe("claimed");
    expect(tipPillOf({ status: "Refunded", refundableAt: at }, at - 999)).toBe("refunded");
  });
  it("uses the spec's labels", () => {
    expect(Object.fromEntries(Object.entries(TIP_PILL).map(([k, v]) => [k, v.label]))).toEqual({
      waiting: "Waiting to be claimed",
      refundable: "Unclaimed, refundable",
      claimed: "Claimed",
      refunded: "Refunded to you",
    });
  });
});

describe("feed chip (W4.2)", () => {
  const data = { events: [], sync: { complete: true } } as unknown as FeedResponse;
  it("Live when the index is complete, Syncing when it lags or loads, Offline on error", () => {
    render(<FeedChip s={{ kind: "ready", data, source: "live", syncing: false }} />);
    expect(screen.getByText("Live")).toBeTruthy();
    cleanup();
    render(<FeedChip s={{ kind: "ready", data, source: "live", syncing: true }} />);
    expect(screen.getByText("Syncing")).toBeTruthy();
    cleanup();
    render(<FeedChip s={{ kind: "loading" }} />);
    expect(screen.getByText("Syncing")).toBeTruthy();
    cleanup();
    render(<FeedChip s={{ kind: "error", lastSync: null, retry: () => undefined, data: null }} />);
    expect(screen.getByText("Offline")).toBeTruthy();
  });
  it("'Example data' only ever labels demo rows", () => {
    render(<FeedChip s={{ kind: "ready", data, source: "demo", syncing: false }} />);
    expect(screen.getByText("Example data")).toBeTruthy();
  });
});
