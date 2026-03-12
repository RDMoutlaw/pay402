import { describe, it, expect, vi, beforeEach } from "vitest";
import type { L402Challenge } from "../src/types/challenge.js";
import type { ArkadeWalletConfig } from "../src/types/wallet.js";

// Mock @arkade-os/sdk
vi.mock("@arkade-os/sdk", () => {
  const mockWallet = {
    sendBitcoin: vi.fn().mockResolvedValue({ txId: "vtxo-bridge-001" }),
    getAddress: vi.fn().mockResolvedValue("ark1bridge-sender"),
    getBalance: vi.fn().mockResolvedValue({ total: 100000, confirmed: 90000, unconfirmed: 10000 }),
  };

  return {
    MnemonicIdentity: vi.fn(),
    Wallet: vi.fn().mockImplementation(() => mockWallet),
    __mockWallet: mockWallet,
  };
});

// Mock @arkade-os/boltz-swap
const mockSwaps = {
  getFees: vi.fn().mockResolvedValue({
    minerFees: 100,
    percentage: 0.5,
    totalEstimate: 250,
  }),
  sendLightningPayment: vi.fn().mockResolvedValue({
    preimage: "abc123preimage",
  }),
};

vi.mock("@arkade-os/boltz-swap", () => ({
  ArkadeSwaps: vi.fn().mockImplementation(() => mockSwaps),
}));

import { ArkadeBridgeProvider } from "../src/bridge/arkade-bridge.js";
import { BridgePaymentFailedError } from "../src/types/errors.js";

const l402Challenge: L402Challenge = {
  type: "l402",
  macaroon: "dGVzdG1hY2Fyb29u",
  invoice: "lnbc100u1rest",
  amountSats: 10000,
  expiresAt: null,
  rawHeader: "test",
};

const arkadeWallet: ArkadeWalletConfig = {
  type: "arkade",
  mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  arkServerUrl: "https://arkade.computer",
  network: "testnet",
};

describe("ArkadeBridgeProvider", () => {
  let provider: ArkadeBridgeProvider;

  beforeEach(() => {
    provider = new ArkadeBridgeProvider();
    vi.clearAllMocks();
  });

  describe("canBridge", () => {
    it("returns true for arkade -> l402", () => {
      expect(provider.canBridge("arkade", "l402")).toBe(true);
    });

    it("returns false for other paths", () => {
      expect(provider.canBridge("l402", "arkade")).toBe(false);
      expect(provider.canBridge("arkade", "x402-base")).toBe(false);
      expect(provider.canBridge("x402-base", "l402")).toBe(false);
    });
  });

  describe("quote", () => {
    it("returns a quote with bridge fees", async () => {
      const quote = await provider.quote(l402Challenge, arkadeWallet, 60000);

      expect(quote.sourceRail).toBe("arkade");
      expect(quote.targetRail).toBe("l402");
      expect(quote.bridgeFeeUsd).toBeGreaterThan(0);
      expect(quote.totalCostUsd).toBeGreaterThan(quote.bridgeFeeUsd);
      expect(quote.estimatedSeconds).toBe(30);
    });

    it("returns $0 costs when btcPriceUsd is not provided", async () => {
      const quote = await provider.quote(l402Challenge, arkadeWallet);
      expect(quote.totalCostUsd).toBe(0);
      expect(quote.bridgeFeeUsd).toBe(0);
    });

    it("throws for non-l402 challenge", async () => {
      await expect(
        provider.quote(
          { type: "arkade", payTo: "ark1test", amountSats: 100, rawHeader: "" },
          arkadeWallet,
          60000,
        ),
      ).rejects.toThrow(BridgePaymentFailedError);
    });
  });

  describe("execute", () => {
    it("calls sendLightningPayment and returns L402 proof", async () => {
      const quote = await provider.quote(l402Challenge, arkadeWallet, 60000);
      const result = await provider.execute(l402Challenge, arkadeWallet, quote);

      expect(mockSwaps.sendLightningPayment).toHaveBeenCalledWith(
        l402Challenge.invoice,
      );
      expect(result.proof.type).toBe("l402");
      if (result.proof.type === "l402") {
        expect(result.proof.preimage).toBe("abc123preimage");
        expect(result.proof.macaroon).toBe(l402Challenge.macaroon);
      }
    });

    it("throws BridgePaymentFailedError when swap fails", async () => {
      mockSwaps.sendLightningPayment.mockRejectedValueOnce(
        new Error("Swap failed"),
      );

      const quote = await provider.quote(l402Challenge, arkadeWallet, 60000);
      await expect(
        provider.execute(l402Challenge, arkadeWallet, quote),
      ).rejects.toThrow(BridgePaymentFailedError);
    });
  });
});
