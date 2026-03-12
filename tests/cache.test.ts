import { describe, it, expect, vi, afterEach } from "vitest";
import { TokenCache } from "../src/cache/token-cache.js";
import type { L402PaymentProof, X402PaymentProof } from "../src/types/payment.js";

const l402Proof: L402PaymentProof = {
  type: "l402",
  macaroon: "abc123",
  preimage: "def456",
};

const x402Proof: X402PaymentProof = {
  type: "x402",
  payload: {
    signature: "0xsig",
    from: "0xfrom",
    to: "0xto",
    value: "1000000",
    validAfter: "0",
    validBefore: "9999999999",
    nonce: "0x1234",
  },
};

describe("TokenCache", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores and retrieves L402 tokens", () => {
    const cache = new TokenCache();
    cache.set("GET", "https://api.example.com/data", l402Proof);

    const entry = cache.get("GET", "https://api.example.com/data");
    expect(entry).not.toBeNull();
    expect(entry!.railId).toBe("l402");
    expect(entry!.token).toBe("abc123:def456");
    expect(entry!.proof).toBe(l402Proof);
  });

  it("stores and retrieves x402 tokens", () => {
    const cache = new TokenCache();
    cache.set("POST", "https://api.example.com/data", x402Proof, 60_000);

    const entry = cache.get("POST", "https://api.example.com/data");
    expect(entry).not.toBeNull();
    expect(entry!.railId).toBe("x402-base");
    expect(entry!.proof).toBe(x402Proof);
  });

  it("keys by method + URL — GET and POST are separate", () => {
    const cache = new TokenCache();
    cache.set("GET", "https://api.example.com/data", l402Proof);
    cache.set("POST", "https://api.example.com/data", x402Proof, 60_000);

    expect(cache.get("GET", "https://api.example.com/data")!.railId).toBe(
      "l402",
    );
    expect(cache.get("POST", "https://api.example.com/data")!.railId).toBe(
      "x402-base",
    );
    expect(cache.size).toBe(2);
  });

  it("returns null for missing entries", () => {
    const cache = new TokenCache();
    expect(cache.get("GET", "https://unknown.com")).toBeNull();
  });

  it("expires entries after TTL", () => {
    vi.useFakeTimers();
    const cache = new TokenCache();
    cache.set("GET", "https://api.example.com/data", l402Proof, 5_000);

    expect(cache.get("GET", "https://api.example.com/data")).not.toBeNull();

    vi.advanceTimersByTime(5_001);

    expect(cache.get("GET", "https://api.example.com/data")).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("deletes entries", () => {
    const cache = new TokenCache();
    cache.set("GET", "https://api.example.com/data", l402Proof);
    expect(cache.delete("GET", "https://api.example.com/data")).toBe(true);
    expect(cache.get("GET", "https://api.example.com/data")).toBeNull();
  });

  it("clears all entries", () => {
    const cache = new TokenCache();
    cache.set("GET", "https://a.com", l402Proof);
    cache.set("GET", "https://b.com", l402Proof);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("method is case-insensitive", () => {
    const cache = new TokenCache();
    cache.set("get", "https://api.example.com/data", l402Proof);
    expect(cache.get("GET", "https://api.example.com/data")).not.toBeNull();
  });
});
