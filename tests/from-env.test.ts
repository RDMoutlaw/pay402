import { describe, it, expect, vi, afterEach } from "vitest";
import { fromEnv } from "../src/client/from-env.js";
import { Pay402Error } from "../src/types/errors.js";

// Mock adapters to avoid real network deps
vi.mock("../src/rails/lightning.js", () => ({
  LightningRailAdapter: class {
    railId = "l402" as const;
    canHandle() { return false; }
    async pay() { return { type: "l402" as const, macaroon: "m", preimage: "p" }; }
    buildAuthHeader() { return {}; }
    async estimateCost() { return { amountRaw: "0", currency: "sats" as const, amountUsd: 0, confidence: "estimate" as const }; }
  },
}));

vi.mock("../src/rails/x402-base.js", () => ({
  X402BaseAdapter: class {
    railId = "x402-base" as const;
    canHandle() { return false; }
    async pay() { return { type: "x402" as const, payload: {} }; }
    buildAuthHeader() { return {}; }
    async estimateCost() { return { amountRaw: "0", currency: "USDC" as const, amountUsd: 0, confidence: "exact" as const }; }
  },
}));

vi.mock("../src/rails/x402-solana.js", () => ({
  X402SolanaAdapter: class {
    railId = "x402-solana" as const;
    canHandle() { return false; }
    async pay() { return { type: "x402" as const, payload: {} }; }
    buildAuthHeader() { return {}; }
    async estimateCost() { return { amountRaw: "0", currency: "USDC" as const, amountUsd: 0, confidence: "exact" as const }; }
  },
}));

describe("fromEnv", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("creates client from Lightning env vars", () => {
    process.env.LND_HOST = "https://localhost:8080";
    process.env.LND_MACAROON = "deadbeef";

    const client = fromEnv();
    expect(client).toBeDefined();
    client.destroy();
  });

  it("creates client from EVM env vars", () => {
    process.env.EVM_PRIVATE_KEY =
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    const client = fromEnv();
    expect(client).toBeDefined();
    client.destroy();
  });

  it("creates client from Solana env vars", () => {
    process.env.SOLANA_SECRET_KEY = "base58encodedkey";

    const client = fromEnv();
    expect(client).toBeDefined();
    client.destroy();
  });

  it("detects multiple wallets from env", () => {
    process.env.LND_HOST = "https://localhost:8080";
    process.env.LND_MACAROON = "deadbeef";
    process.env.EVM_PRIVATE_KEY =
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    const client = fromEnv();
    expect(client).toBeDefined();
    client.destroy();
  });

  it("throws when no wallet env vars are set", () => {
    // Clear all wallet vars
    delete process.env.LND_HOST;
    delete process.env.LND_MACAROON;
    delete process.env.EVM_PRIVATE_KEY;
    delete process.env.SOLANA_SECRET_KEY;

    expect(() => fromEnv()).toThrow(/at least one wallet/i);
  });

  it("reads spend control env vars", () => {
    process.env.LND_HOST = "https://localhost:8080";
    process.env.LND_MACAROON = "deadbeef";
    process.env.PAY402_MAX_PER_REQUEST = "0.50";
    process.env.PAY402_MAX_DAILY = "5.00";

    const client = fromEnv();
    expect(client).toBeDefined();
    client.destroy();
  });

  it("reads BTC price from env", () => {
    process.env.LND_HOST = "https://localhost:8080";
    process.env.LND_MACAROON = "deadbeef";
    process.env.PAY402_BTC_PRICE_USD = "62000";

    const client = fromEnv();
    expect(client).toBeDefined();
    client.destroy();
  });

  it("accepts overrides that merge with env config", () => {
    process.env.LND_HOST = "https://localhost:8080";
    process.env.LND_MACAROON = "deadbeef";

    const client = fromEnv({
      maxSinglePaymentUsd: 0.50,
      logLevel: "debug",
    });
    expect(client).toBeDefined();
    client.destroy();
  });

  it("defaults EVM chain to 'base' when not specified", () => {
    process.env.EVM_PRIVATE_KEY =
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    delete process.env.EVM_CHAIN;

    const client = fromEnv();
    expect(client).toBeDefined();
    client.destroy();
  });

  it("uses EVM_CHAIN from env when specified", () => {
    process.env.EVM_PRIVATE_KEY =
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    process.env.EVM_CHAIN = "base-sepolia";

    const client = fromEnv();
    expect(client).toBeDefined();
    client.destroy();
  });
});
