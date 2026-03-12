import { describe, it, expect, vi, beforeEach } from "vitest";
import { LendasatBridgeProvider } from "../src/bridge/lendasat-bridge.js";
import { BridgePaymentFailedError } from "../src/types/errors.js";
import type { L402Challenge } from "../src/types/challenge.js";
import type { EVMWalletConfig } from "../src/types/wallet.js";
import type { BridgeQuote } from "../src/types/bridge.js";

// --- Mock SDK ---

const mockGetSwap = vi.fn();
const mockFundSwapGasless = vi.fn();
const mockCreateSwap = vi.fn();
const mockBuild = vi.fn();

vi.mock("@lendasat/lendaswap-sdk-pure", () => {
  return {
    InMemoryWalletStorage: class {},
    InMemorySwapStorage: class {},
    Client: {
      builder: () => ({
        withSignerStorage: function () {
          return this;
        },
        withSwapStorage: function () {
          return this;
        },
        build: mockBuild,
      }),
    },
  };
});

const mockChallenge: L402Challenge = {
  type: "l402",
  macaroon: "dGVzdG1hY2Fyb29u",
  invoice: "lnbc100u1rest",
  amountSats: 10000,
  expiresAt: null,
  rawHeader: 'L402 macaroon="dGVzdG1hY2Fyb29u", invoice="lnbc100u1rest"',
};

const mockWallet: EVMWalletConfig = {
  type: "evm",
  privateKey:
    "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  chain: "base",
};

const mockQuote: BridgeQuote = {
  sourceRail: "x402-base",
  targetRail: "l402",
  totalCostUsd: 0.08,
  bridgeFeeUsd: 0.01,
  estimatedSeconds: 90,
};

describe("LendasatBridgeProvider", () => {
  let provider: LendasatBridgeProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new LendasatBridgeProvider();

    // Default mock implementations
    mockCreateSwap.mockResolvedValue({
      id: "swap-001",
      source_amount: "1.50",
      fee_sats: 100,
      status: "created",
    });
    mockFundSwapGasless.mockResolvedValue(undefined);
    mockBuild.mockResolvedValue({
      createEvmToLightningSwapGeneric: mockCreateSwap,
      fundSwapGasless: mockFundSwapGasless,
      getSwap: mockGetSwap,
    });
  });

  // --- canBridge ---

  it("canBridge returns true for x402-base -> l402", () => {
    expect(provider.canBridge("x402-base", "l402")).toBe(true);
  });

  it("canBridge returns false for all other combos", () => {
    expect(provider.canBridge("l402", "x402-base")).toBe(false);
    expect(provider.canBridge("arkade", "l402")).toBe(false);
    expect(provider.canBridge("x402-base", "x402-solana")).toBe(false);
    expect(provider.canBridge("x402-solana", "l402")).toBe(false);
  });

  // --- quote ---

  it("returns a valid BridgeQuote with fee estimate", async () => {
    const quote = await provider.quote(mockChallenge, mockWallet, 60000);

    expect(quote.sourceRail).toBe("x402-base");
    expect(quote.targetRail).toBe("l402");
    expect(quote.estimatedSeconds).toBe(90);
    expect(quote.bridgeFeeUsd).toBeGreaterThan(0);
    expect(quote.totalCostUsd).toBeGreaterThan(quote.bridgeFeeUsd);
  });

  it("quote throws on wrong challenge type", async () => {
    const x402Challenge = {
      type: "x402" as const,
      scheme: "exact" as const,
      network: "base" as const,
      maxAmountRequired: "1000000",
      resource: "https://example.com",
      payTo: "0xRecipient",
      asset: "0xUSDC",
      maxTimeoutSeconds: 60,
      rawHeader: "",
    };

    await expect(
      provider.quote(x402Challenge, mockWallet, 60000),
    ).rejects.toThrow(BridgePaymentFailedError);
  });

  it("quote throws on wrong wallet type", async () => {
    const lightningWallet = {
      type: "lightning" as const,
      lndHost: "https://localhost:8080",
      lndMacaroon: "deadbeef",
    };

    await expect(
      provider.quote(mockChallenge, lightningWallet, 60000),
    ).rejects.toThrow(BridgePaymentFailedError);
  });

  // --- execute happy path ---

  it("creates swap, funds, polls, and returns L402 proof with preimage", async () => {
    // First poll: not paid yet. Second poll: paid with preimage.
    mockGetSwap
      .mockResolvedValueOnce({
        id: "swap-001",
        status: "pending",
        lightning_paid: false,
        source_amount: "1.50",
        fee_sats: 100,
      })
      .mockResolvedValueOnce({
        id: "swap-001",
        status: "completed",
        lightning_paid: true,
        preimage: "abcdef1234567890preimage",
        source_amount: "1.50",
        fee_sats: 100,
      });

    const result = await provider.execute(mockChallenge, mockWallet, mockQuote);

    expect(result.proof).toEqual({
      type: "l402",
      macaroon: "dGVzdG1hY2Fyb29u",
      preimage: "abcdef1234567890preimage",
    });
    expect(result.actualCostUsd).toBe(mockQuote.totalCostUsd);

    // Verify swap was created with correct params
    expect(mockCreateSwap).toHaveBeenCalledWith(
      expect.objectContaining({
        lightningInvoice: "lnbc100u1rest",
        evmChainId: 137,
        tokenAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
        gasless: true,
      }),
    );
    expect(mockFundSwapGasless).toHaveBeenCalledWith("swap-001");
    expect(mockGetSwap).toHaveBeenCalledTimes(2);
  });

  // --- execute timeout ---

  it("throws BridgePaymentFailedError on poll timeout", async () => {
    // getSwap never returns lightning_paid: true
    mockGetSwap.mockResolvedValue({
      id: "swap-001",
      status: "pending",
      lightning_paid: false,
      source_amount: "1.50",
      fee_sats: 100,
    });

    // Mock Date.now to jump past deadline and setTimeout to resolve immediately
    let callCount = 0;
    const startTime = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => {
      // First call sets deadline, subsequent calls exceed it quickly
      return startTime + callCount++ * 130_000;
    });
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: () => void,
    ) => {
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    await expect(
      provider.execute(mockChallenge, mockWallet, mockQuote),
    ).rejects.toThrow(BridgePaymentFailedError);

    vi.restoreAllMocks();
  });

  // --- execute SDK missing ---

  it("throws with install instructions when SDK is missing", async () => {
    // Override the mock to simulate missing module
    vi.doMock("@lendasat/lendaswap-sdk-pure", () => {
      throw new Error("Cannot find module '@lendasat/lendaswap-sdk-pure'");
    });

    // Need a fresh provider that will hit the new mock
    const { LendasatBridgeProvider: FreshProvider } = await import(
      "../src/bridge/lendasat-bridge.js"
    );
    const freshProvider = new FreshProvider();

    await expect(
      freshProvider.execute(mockChallenge, mockWallet, mockQuote),
    ).rejects.toThrow(/install it with/);

    // Restore the original mock
    vi.doMock("@lendasat/lendaswap-sdk-pure", () => ({
      InMemoryWalletStorage: class {},
      InMemorySwapStorage: class {},
      Client: {
        builder: () => ({
          withSignerStorage: function () {
            return this;
          },
          withSwapStorage: function () {
            return this;
          },
          build: mockBuild,
        }),
      },
    }));
  });

  // --- custom config ---

  it("uses custom chainId and tokenAddress", async () => {
    const customProvider = new LendasatBridgeProvider({
      chainId: 1,
      tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    });

    mockGetSwap.mockResolvedValueOnce({
      id: "swap-002",
      status: "completed",
      lightning_paid: true,
      preimage: "custompreimage",
      source_amount: "1.50",
      fee_sats: 100,
    });

    await customProvider.execute(mockChallenge, mockWallet, mockQuote);

    expect(mockCreateSwap).toHaveBeenCalledWith(
      expect.objectContaining({
        evmChainId: 1,
        tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      }),
    );
  });
});
