import { describe, it, expect, vi, afterEach } from "vitest";
import { LightningRailAdapter } from "../src/rails/lightning.js";
import { X402BaseAdapter } from "../src/rails/x402-base.js";
import { X402SolanaAdapter } from "../src/rails/x402-solana.js";
import type { L402Challenge, X402Challenge } from "../src/types/challenge.js";
import { PaymentFailedError } from "../src/types/errors.js";

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

const solanaChallenge: X402Challenge = {
  ...x402Challenge,
  network: "solana-devnet",
  payTo: "DRpbCBMxVnDK7maPMoGQfFKkLTcBLgrMbcFGPmgUAP9a",
  asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};

describe("LightningRailAdapter — edge cases", () => {
  const adapter = new LightningRailAdapter();
  let originalFetch: typeof globalThis.fetch;

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it("throws PaymentFailedError when given wrong wallet type", async () => {
    await expect(
      adapter.pay(l402Challenge, {
        type: "evm",
        privateKey:
          "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        chain: "base",
      }),
    ).rejects.toThrow(PaymentFailedError);
  });

  it("throws PaymentFailedError when given wrong challenge type", async () => {
    await expect(
      adapter.pay(x402Challenge, {
        type: "lightning",
        lndHost: "https://localhost:8080",
        lndMacaroon: "deadbeef",
      }),
    ).rejects.toThrow(PaymentFailedError);
  });

  it("throws PaymentFailedError when LND returns error object", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { message: "invoice already settled" } }),
        { status: 200 },
      ),
    );

    await expect(
      adapter.pay(l402Challenge, {
        type: "lightning",
        lndHost: "https://localhost:8080",
        lndMacaroon: "deadbeef",
      }),
    ).rejects.toThrow(/invoice already settled/);
  });

  it("throws PaymentFailedError when LND returns empty result", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await expect(
      adapter.pay(l402Challenge, {
        type: "lightning",
        lndHost: "https://localhost:8080",
        lndMacaroon: "deadbeef",
      }),
    ).rejects.toThrow(/empty result/);
  });

  it("throws PaymentFailedError when SUCCEEDED but no preimage", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ result: { status: "SUCCEEDED" } }),
        { status: 200 },
      ),
    );

    await expect(
      adapter.pay(l402Challenge, {
        type: "lightning",
        lndHost: "https://localhost:8080",
        lndMacaroon: "deadbeef",
      }),
    ).rejects.toThrow(/no preimage/);
  });

  it("throws PaymentFailedError for unknown payment status", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ result: { status: "UNKNOWN_STATUS" } }),
        { status: 200 },
      ),
    );

    await expect(
      adapter.pay(l402Challenge, {
        type: "lightning",
        lndHost: "https://localhost:8080",
        lndMacaroon: "deadbeef",
      }),
    ).rejects.toThrow(/Unknown payment status/);
  });

  it("throws PaymentFailedError when LND returns non-200", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response("Unauthorized", { status: 401 }),
    );

    await expect(
      adapter.pay(l402Challenge, {
        type: "lightning",
        lndHost: "https://localhost:8080",
        lndMacaroon: "deadbeef",
      }),
    ).rejects.toThrow(/401/);
  });

  it("throws PaymentFailedError for malformed JSON response", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response("not json at all", { status: 200 }),
    );

    await expect(
      adapter.pay(l402Challenge, {
        type: "lightning",
        lndHost: "https://localhost:8080",
        lndMacaroon: "deadbeef",
      }),
    ).rejects.toThrow(/Invalid LND response/);
  });

  it("estimates zero USD when btcPriceUsd is not provided", async () => {
    const estimate = await adapter.estimateCost(l402Challenge);
    expect(estimate.amountUsd).toBe(0);
    expect(estimate.amountRaw).toBe("10000");
  });

  it("estimates zero USD for zero-amount invoice", async () => {
    const zeroChallenge: L402Challenge = {
      ...l402Challenge,
      amountSats: null,
    };
    const estimate = await adapter.estimateCost(zeroChallenge, 60000);
    expect(estimate.amountUsd).toBe(0);
  });
});

describe("X402BaseAdapter — edge cases", () => {
  const adapter = new X402BaseAdapter();

  it("throws PaymentFailedError when given wrong wallet type", async () => {
    await expect(
      adapter.pay(x402Challenge, {
        type: "lightning",
        lndHost: "https://localhost:8080",
        lndMacaroon: "deadbeef",
      }),
    ).rejects.toThrow(PaymentFailedError);
  });

  it("throws PaymentFailedError when given wrong challenge type", async () => {
    await expect(
      adapter.pay(l402Challenge, {
        type: "evm",
        privateKey:
          "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        chain: "base",
      }),
    ).rejects.toThrow(PaymentFailedError);
  });

  it("throws for non-x402 proof in buildAuthHeader", () => {
    expect(() =>
      adapter.buildAuthHeader({
        type: "l402",
        macaroon: "m",
        preimage: "p",
      }),
    ).toThrow(/Not an x402 proof/);
  });

  it("throws for non-x402 challenge in estimateCost", async () => {
    await expect(adapter.estimateCost(l402Challenge)).rejects.toThrow(
      /Not an x402 challenge/,
    );
  });
});

describe("X402SolanaAdapter — edge cases", () => {
  const adapter = new X402SolanaAdapter();
  let originalFetch: typeof globalThis.fetch;

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it("handles base58 string secret key", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ signature: "sig123" }), { status: 200 }),
    );

    const { Keypair } = await import("@solana/web3.js");
    const { default: bs58 } = await import("bs58");
    const kp = Keypair.generate();
    const base58Key = bs58.encode(kp.secretKey);

    const proof = await adapter.pay(solanaChallenge, {
      type: "solana",
      secretKey: base58Key,
      cluster: "devnet",
      facilitatorUrl: "https://facilitator.example.com/pay",
    });

    expect(proof.type).toBe("x402");
  });

  it("throws for non-x402 proof in buildAuthHeader", () => {
    expect(() =>
      adapter.buildAuthHeader({
        type: "l402",
        macaroon: "m",
        preimage: "p",
      }),
    ).toThrow(/Not an x402 proof/);
  });

  it("throws for non-x402 challenge in estimateCost", async () => {
    await expect(adapter.estimateCost(l402Challenge)).rejects.toThrow(
      /Not an x402 challenge/,
    );
  });
});
