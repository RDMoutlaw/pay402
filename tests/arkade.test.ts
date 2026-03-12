import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ArkadeChallenge } from "../src/types/challenge.js";
import type { ArkadeWalletConfig } from "../src/types/wallet.js";

// Mock @arkade-os/sdk before importing adapter
vi.mock("@arkade-os/sdk", () => {
  const mockWallet = {
    sendBitcoin: vi.fn().mockResolvedValue({ txId: "vtxo-tx-001" }),
    getAddress: vi.fn().mockResolvedValue("ark1sender"),
    getBalance: vi.fn().mockResolvedValue({ total: 100000, confirmed: 90000, unconfirmed: 10000 }),
  };

  return {
    MnemonicIdentity: vi.fn(),
    Wallet: vi.fn().mockImplementation(() => mockWallet),
    __mockWallet: mockWallet,
  };
});

import { ArkadeRailAdapter, getOrCreateArkadeWallet } from "../src/rails/arkade.js";
import { PaymentFailedError } from "../src/types/errors.js";

const arkadeChallenge: ArkadeChallenge = {
  type: "arkade",
  payTo: "ark1recipient",
  amountSats: 5000,
  maxTimeoutSeconds: 60,
  rawHeader: "test",
};

const arkadeWallet: ArkadeWalletConfig = {
  type: "arkade",
  mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  arkServerUrl: "https://arkade.computer",
  network: "testnet",
};

describe("ArkadeRailAdapter", () => {
  let adapter: ArkadeRailAdapter;

  beforeEach(() => {
    adapter = new ArkadeRailAdapter();
  });

  it("has railId 'arkade'", () => {
    expect(adapter.railId).toBe("arkade");
  });

  describe("canHandle", () => {
    it("returns true for arkade challenges", () => {
      expect(adapter.canHandle(arkadeChallenge)).toBe(true);
    });

    it("returns false for l402 challenges", () => {
      expect(
        adapter.canHandle({
          type: "l402",
          macaroon: "test",
          invoice: "lnbc1...",
          amountSats: 100,
          expiresAt: null,
          rawHeader: "test",
        }),
      ).toBe(false);
    });
  });

  describe("pay", () => {
    it("sends payment and returns ArkadePaymentProof", async () => {
      const proof = await adapter.pay(arkadeChallenge, arkadeWallet);
      expect(proof.type).toBe("arkade");
      if (proof.type === "arkade") {
        expect(proof.txId).toBe("vtxo-tx-001");
        expect(proof.from).toBe("ark1sender");
      }
    });

    it("throws PaymentFailedError for non-arkade challenge", async () => {
      await expect(
        adapter.pay(
          { type: "l402", macaroon: "", invoice: "", amountSats: 0, expiresAt: null, rawHeader: "" },
          arkadeWallet,
        ),
      ).rejects.toThrow(PaymentFailedError);
    });

    it("throws PaymentFailedError for non-arkade wallet", async () => {
      await expect(
        adapter.pay(arkadeChallenge, {
          type: "lightning",
          lndHost: "https://localhost:8080",
          lndMacaroon: "deadbeef",
        }),
      ).rejects.toThrow(PaymentFailedError);
    });
  });

  describe("buildAuthHeader", () => {
    it("returns X-Arkade-Payment-Proof header with base64 JSON", () => {
      const headers = adapter.buildAuthHeader({
        type: "arkade",
        txId: "vtxo-tx-001",
        from: "ark1sender",
      });

      expect(headers["X-Arkade-Payment-Proof"]).toBeDefined();
      const decoded = JSON.parse(atob(headers["X-Arkade-Payment-Proof"]));
      expect(decoded.txId).toBe("vtxo-tx-001");
      expect(decoded.from).toBe("ark1sender");
    });

    it("throws for non-arkade proof", () => {
      expect(() =>
        adapter.buildAuthHeader({
          type: "l402",
          macaroon: "test",
          preimage: "test",
        }),
      ).toThrow("Not an Arkade proof");
    });
  });

  describe("estimateCost", () => {
    it("returns sats-based cost with exact confidence", async () => {
      const estimate = await adapter.estimateCost(arkadeChallenge, 60000);
      expect(estimate.amountRaw).toBe("5000");
      expect(estimate.currency).toBe("sats");
      expect(estimate.amountUsd).toBeCloseTo(3.0); // 5000 sats at $60k
      expect(estimate.confidence).toBe("exact");
    });

    it("returns $0 when btcPriceUsd is not provided", async () => {
      const estimate = await adapter.estimateCost(arkadeChallenge);
      expect(estimate.amountUsd).toBe(0);
    });
  });
});

describe("getOrCreateArkadeWallet", () => {
  it("caches wallet instances by server URL + mnemonic prefix", async () => {
    const wallet1 = await getOrCreateArkadeWallet(arkadeWallet);
    const wallet2 = await getOrCreateArkadeWallet(arkadeWallet);
    expect(wallet1).toBe(wallet2);
  });
});
