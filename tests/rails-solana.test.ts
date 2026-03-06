import { describe, it, expect, vi, afterEach } from "vitest";
import { X402SolanaAdapter } from "../src/rails/x402-solana.js";
import type { X402Challenge, L402Challenge } from "../src/types/challenge.js";
import { PaymentFailedError } from "../src/types/errors.js";

const solanaChallenge: X402Challenge = {
  type: "x402",
  scheme: "exact",
  network: "solana-devnet",
  maxAmountRequired: "500000", // 0.50 USDC
  resource: "https://api.example.com/data",
  payTo: "DRpbCBMxVnDK7maPMoGQfFKkLTcBLgrMbcFGPmgUAP9a",
  asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC on Solana
  maxTimeoutSeconds: 60,
  rawHeader: "{}",
};

const baseChallenge: X402Challenge = {
  ...solanaChallenge,
  network: "base",
};

const l402Challenge: L402Challenge = {
  type: "l402",
  macaroon: "abc",
  invoice: "lnbc100u1rest",
  amountSats: 10000,
  expiresAt: null,
  rawHeader: "",
};

describe("X402SolanaAdapter", () => {
  const adapter = new X402SolanaAdapter();
  let originalFetch: typeof globalThis.fetch;

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it("canHandle returns true for solana network", () => {
    expect(adapter.canHandle(solanaChallenge)).toBe(true);
  });

  it("canHandle returns true for solana-devnet", () => {
    expect(
      adapter.canHandle({ ...solanaChallenge, network: "solana-devnet" }),
    ).toBe(true);
  });

  it("canHandle returns false for base network", () => {
    expect(adapter.canHandle(baseChallenge)).toBe(false);
  });

  it("canHandle returns false for l402", () => {
    expect(adapter.canHandle(l402Challenge)).toBe(false);
  });

  it("estimates cost as exact USD for USDC", async () => {
    const estimate = await adapter.estimateCost(solanaChallenge);
    expect(estimate.currency).toBe("USDC");
    expect(estimate.amountUsd).toBe(0.5);
    expect(estimate.amountRaw).toBe("500000");
    expect(estimate.confidence).toBe("exact");
  });

  it("builds X-PAYMENT header with base64-encoded payload", () => {
    const headers = adapter.buildAuthHeader({
      type: "x402",
      payload: {
        signature: "solana-sig",
        from: "sender",
        to: "recipient",
        value: "500000",
        validAfter: "0",
        validBefore: "9999999",
        nonce: "abc",
      },
    });
    expect(headers["X-PAYMENT"]).toBeTruthy();
    const decoded = JSON.parse(atob(headers["X-PAYMENT"]));
    expect(decoded.signature).toBe("solana-sig");
  });

  it("pays via facilitator when facilitatorUrl is set", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ signature: "facilitator-sig" }), {
        status: 200,
      }),
    );

    // Generate a valid Solana keypair (64 bytes)
    const { Keypair } = await import("@solana/web3.js");
    const kp = Keypair.generate();

    const proof = await adapter.pay(solanaChallenge, {
      type: "solana",
      secretKey: kp.secretKey,
      cluster: "devnet",
      facilitatorUrl: "https://facilitator.example.com/pay",
    });

    expect(proof.type).toBe("x402");
    if (proof.type === "x402") {
      expect(proof.payload.signature).toBe("facilitator-sig");
      expect(proof.payload.to).toBe(solanaChallenge.payTo);
    }

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://facilitator.example.com/pay",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws PaymentFailedError when facilitator fails", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response("error", { status: 500 }),
    );

    const { Keypair } = await import("@solana/web3.js");
    const kp = Keypair.generate();

    await expect(
      adapter.pay(solanaChallenge, {
        type: "solana",
        secretKey: kp.secretKey,
        cluster: "devnet",
        facilitatorUrl: "https://facilitator.example.com/pay",
      }),
    ).rejects.toThrow(PaymentFailedError);
  });

  it("throws PaymentFailedError for wrong wallet type", async () => {
    await expect(
      adapter.pay(solanaChallenge, {
        type: "evm",
        privateKey:
          "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        chain: "base",
      }),
    ).rejects.toThrow(PaymentFailedError);
  });

  it("throws PaymentFailedError for wrong challenge type", async () => {
    const { Keypair } = await import("@solana/web3.js");
    const kp = Keypair.generate();

    await expect(
      adapter.pay(l402Challenge, {
        type: "solana",
        secretKey: kp.secretKey,
        cluster: "devnet",
      }),
    ).rejects.toThrow(PaymentFailedError);
  });
});
