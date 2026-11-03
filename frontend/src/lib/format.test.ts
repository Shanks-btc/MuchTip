import { describe, expect, it } from "vitest";
import { parseEther } from "viem";
import { parseDoge, sanitizeAmountInput } from "./amount";
import { formatCountdown, formatDayLabel, formatDoge, formatDogeFixed, formatDuration, formatDurationLong, formatEventTime, formatFeeRange, formatFeeTo, initials, shortAddr, shortHash } from "./format";
import { explorerAddr, explorerTx } from "../chain/config";

describe("formatDoge", () => {
  it("formats wei without floating point", () => {
    expect(formatDoge("10000000000000000")).toBe("0.01");
    expect(formatDoge(parseEther("1234567.891"), 2)).toBe("1,234,567.89");
    expect(formatDoge(0n)).toBe("0");
  });
});

describe("formatDogeFixed", () => {
  it("rounds an 'at most' figure up and a balance down", () => {
    expect(formatDogeFixed(parseEther("25.021"), 2, "up")).toBe("25.03");
    expect(formatDogeFixed(parseEther("25.029"), 2, "down")).toBe("25.02");
    expect(formatDogeFixed(parseEther("25"), 2, "up")).toBe("25.00");
  });
});

describe("formatFeeRange", () => {
  it("shows two decimals like the spec", () => {
    expect(formatFeeRange(parseEther("0.0219"), parseEther("0.03285"))).toBe("0.02 – 0.04");
  });
  it("adds decimals instead of showing 0.00", () => {
    expect(formatFeeRange(parseEther("0.0071"), parseEther("0.01065"))).toBe("0.007 – 0.011");
  });
  it("says 'up to' for the fallback ceiling", () => {
    expect(formatFeeRange(null, parseEther("0.35"))).toBe("up to 0.35");
  });
});

describe("app wording (spec v5)", () => {
  it("writes fee ranges with 'to'", () => {
    expect(formatFeeTo(parseEther("0.0119"), parseEther("0.0179"))).toBe("0.01 to 0.02");
    expect(formatFeeTo(null, parseEther("0.35"))).toBe("up to 0.35");
  });
  it("spells out durations in sentences", () => {
    expect(formatDurationLong(600)).toBe("10 minutes");
    expect(formatDurationLong(60)).toBe("1 minute");
    expect(formatDurationLong(604800)).toBe("7 days");
  });
  it("labels days like My tips", () => {
    const now = new Date(2026, 9, 31, 15, 0);
    expect(formatDayLabel(new Date(2026, 9, 31, 13, 24), now)).toBe("Today 13:24");
    expect(formatDayLabel(new Date(2026, 9, 30, 9, 0), now)).toBe("Yesterday");
    expect(formatDayLabel(new Date(2026, 9, 28, 9, 0), now)).toBe("Oct 28");
    expect(formatEventTime(new Date(2026, 9, 31, 13, 24))).toBe("Oct 31, 13:24");
  });
});

describe("durations and countdowns", () => {
  it("matches the spec's wording", () => {
    expect(formatDuration(600)).toBe("10 min");
    expect(formatDuration(604800)).toBe("7 days");
    expect(formatCountdown(362)).toBe("6:02");
    expect(formatCountdown(3723)).toBe("1:02:03");
    expect(formatCountdown(-5)).toBe("0:00");
  });
});

describe("parseDoge", () => {
  it("accepts plain decimals and rejects the rest", () => {
    expect(parseDoge("100")).toBe(parseEther("100"));
    expect(parseDoge("0.5")).toBe(parseEther("0.5"));
    expect(parseDoge(".5")).toBe(parseEther("0.5"));
    expect(parseDoge("1,000")).toBe(parseEther("1000"));
    for (const bad of ["", "0", "-1", "1e3", "abc", "1.2.3", `1.${"1".repeat(19)}`]) expect(parseDoge(bad)).toBeNull();
  });
  it("sanitizes typing", () => {
    expect(sanitizeAmountInput("12a.3.4")).toBe("12.34");
  });
});

describe("small helpers", () => {
  it("abbreviates addresses and makes initials", () => {
    expect(shortAddr("0x1BE5DB49a70d633c6e6AF7900598118Fb65419AE")).toBe("0x1BE5…19AE");
    expect(initials("X Developers", "XDevelopers")).toBe("XD");
    expect(initials(null, "jack")).toBe("JA");
    expect(shortHash("0x06fda845730bdc4246e004be5c31a4bcb5500dc7dfe4d6b1fe897bbc32624d34")).toBe("0x06fd…4d34");
  });
  it("links to the explorer", () => {
    expect(explorerTx("0xabc")).toBe("https://blockscout.testnet.dogeos.com/tx/0xabc");
    expect(explorerAddr("0x1BE5DB49a70d633c6e6AF7900598118Fb65419AE")).toBe("https://blockscout.testnet.dogeos.com/address/0x1BE5DB49a70d633c6e6AF7900598118Fb65419AE");
  });
});
