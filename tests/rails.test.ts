import { describe, it, expect, vi, afterEach } from "vitest";
import { LightningRailAdapter } from "../src/rails/lightning.js";
import { X402BaseAdapter } from "../src/rails/x402-base.js";
import type { L402Challenge, X402Challenge } from "../src/types/challenge.js";
import {
  PaymentFailedError,
  PaymentInFlightError,
  InvoiceExpiredError,
} from "../src/types/errors.js";

const l402Challenge: L402Challenge = {
  type: "l402",
  macaroon: "dGVzdG1hY2Fyb29u",
  invoice: "lnbc100u1rest",
  amountSats: 10_000,
  expiresAt: null,
  rawHeader: 'L402 macaroon="dGVzdG1hY2Fyb29u", invoice="lnbc100u1rest"',
};

const x402Challenge: X402Challenge = {
  type: "x402",
  scheme: "exact",
  network: "base",
  maxAmountRequired: "1000000",
  resource: "https://api.example.com/data",
  payTo: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  maxTimeoutSeconds: 60,
  rawHeader: "{}",
};

describe("LightningRailAdapter", () => {
  const adapter = new LightningRailAdapter();
  let originalFetch: typeof globalThis.fetch;

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it("canHandle returns true for l402 challenges", () => {
    expect(adapter.canHandle(l402Challenge)).toBe(true);
  });

  it("canHandle returns false for x402 challenges", () => {
    expect(adapter.canHandle(x402Challenge)).toBe(false);
  });

  it("pays successfully with valid LND response", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          result: {
            status: "SUCCEEDED",
            payment_preimage: "abc123preimage",
          },
        }),
        { status: 200 },
      ),
    );

    const proof = await adapter.pay(l402Challenge, {
      type: "lightning",
      lndHost: "https://localhost:8080",
      lndMacaroon: "deadbeef",
    });

    expect(proof.type).toBe("l402");
    if (proof.type === "l402") {
      expect(proof.preimage).toBe("abc123preimage");
      expect(proof.macaroon).toBe("dGVzdG1hY2Fyb29u");
    }
  });

  it("throws PaymentFailedError when LND returns FAILED", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          result: {
            status: "FAILED",
            failure_reason: "NO_ROUTE",
          },
        }),
        { status: 200 },
      ),
    );

    await expect(
      adapter.pay(l402Challenge, {
        type: "lightning",
        lndHost: "https://localhost:8080",
        lndMacaroon: "deadbeef",
      }),
    ).rejects.toThrow(PaymentFailedError);
  });

  it("throws PaymentInFlightError when LND returns IN_FLIGHT", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ result: { status: "IN_FLIGHT" } }),
        { status: 200 },
      ),
    );

    await expect(
      adapter.pay(l402Challenge, {
        type: "lightning",
        lndHost: "https://localhost:8080",
        lndMacaroon: "deadbeef",
      }),
    ).rejects.toThrow(PaymentInFlightError);
  });

  it("throws InvoiceExpiredError for expired invoices", async () => {
    const expired: L402Challenge = {
      ...l402Challenge,
      expiresAt: new Date(Date.now() - 60_000), // 1 min ago
    };

    await expect(
      adapter.pay(expired, {
        type: "lightning",
        lndHost: "https://localhost:8080",
        lndMacaroon: "deadbeef",
      }),
    ).rejects.toThrow(InvoiceExpiredError);
  });

  it("throws PaymentFailedError when LND is unreachable", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    await expect(
      adapter.pay(l402Challenge, {
        type: "lightning",
        lndHost: "https://localhost:8080",
        lndMacaroon: "deadbeef",
      }),
    ).rejects.toThrow(PaymentFailedError);
  });

  it("builds correct Authorization header", () => {
    const headers = adapter.buildAuthHeader({
      type: "l402",
      macaroon: "mac123",
      preimage: "pre456",
    });
    expect(headers.Authorization).toBe("L402 mac123:pre456");
  });

  it("estimates cost in sats and USD", async () => {
    const estimate = await adapter.estimateCost(l402Challenge, 60_000);
    expect(estimate.currency).toBe("sats");
    expect(estimate.amountRaw).toBe("10000");
    expect(estimate.amountUsd).toBeCloseTo(6.0, 1);
    expect(estimate.confidence).toBe("estimate");
  });

  it("handles LND streaming response (multiple lines)", async () => {
    originalFetch = globalThis.fetch;
    const lines = [
      JSON.stringify({ result: { status: "IN_FLIGHT" } }),
      JSON.stringify({
        result: { status: "SUCCEEDED", payment_preimage: "final" },
      }),
    ].join("\n");

    globalThis.fetch = vi.fn(async () =>
      new Response(lines, { status: 200 }),
    );

    const proof = await adapter.pay(l402Challenge, {
      type: "lightning",
      lndHost: "https://localhost:8080",
      lndMacaroon: "deadbeef",
    });

    if (proof.type === "l402") {
      expect(proof.preimage).toBe("final");
    }
  });
});

describe("X402BaseAdapter", () => {
  const adapter = new X402BaseAdapter();
  let originalFetch: typeof globalThis.fetch;

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it("canHandle returns true for base network x402", () => {
    expect(adapter.canHandle(x402Challenge)).toBe(true);
  });

  it("canHandle returns true for base-sepolia", () => {
    expect(
      adapter.canHandle({ ...x402Challenge, network: "base-sepolia" }),
    ).toBe(true);
  });

  it("canHandle returns false for solana", () => {
    expect(
      adapter.canHandle({ ...x402Challenge, network: "solana" }),
    ).toBe(false);
  });

  it("canHandle returns false for l402", () => {
    expect(adapter.canHandle(l402Challenge)).toBe(false);
  });

  it("pays successfully with facilitator", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response('{"success":true}', { status: 200 }),
    );

    const proof = await adapter.pay(x402Challenge, {
      type: "evm",
      privateKey:
        "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      chain: "base",
    });

    expect(proof.type).toBe("x402");
    if (proof.type === "x402") {
      expect(proof.payload.signature).toBeTruthy();
      expect(proof.payload.to).toBe("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
      expect(proof.payload.value).toBe("1000000");
    }
  });

  it("throws PaymentFailedError when facilitator fails", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response("Internal Server Error", { status: 500 }),
    );

    await expect(
      adapter.pay(x402Challenge, {
        type: "evm",
        privateKey:
          "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        chain: "base",
      }),
    ).rejects.toThrow(PaymentFailedError);
  });

  it("builds X-PAYMENT header with base64-encoded payload", () => {
    const headers = adapter.buildAuthHeader({
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
    });

    expect(headers["X-PAYMENT"]).toBeTruthy();
    const decoded = JSON.parse(atob(headers["X-PAYMENT"]));
    expect(decoded.signature).toBe("0xsig");
  });

  it("estimates cost as exact USD for USDC", async () => {
    const estimate = await adapter.estimateCost(x402Challenge);
    expect(estimate.currency).toBe("USDC");
    expect(estimate.amountUsd).toBe(1.0);
    expect(estimate.confidence).toBe("exact");
  });

  it("handles large USDC amounts correctly", async () => {
    const expensive = { ...x402Challenge, maxAmountRequired: "50000000" }; // 50 USDC
    const estimate = await adapter.estimateCost(expensive);
    expect(estimate.amountUsd).toBe(50.0);
  });
});
