import type { BridgeProvider, BridgeQuote, BridgeResult } from "../types/bridge.js";
import type { PaymentChallenge, L402Challenge } from "../types/challenge.js";
import type { RailId } from "../types/payment.js";
import type { WalletConfig, EVMWalletConfig } from "../types/wallet.js";
import { BridgePaymentFailedError } from "../types/errors.js";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;

/** Default: Polygon USDC */
const DEFAULT_CHAIN_ID = 137;
const DEFAULT_TOKEN_ADDRESS = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

export interface LendasatBridgeConfig {
  chainId?: number;
  tokenAddress?: string;
}

/**
 * Bridge provider for USDC (EVM) → L402 (Lightning) via LendaSat atomic swap.
 * Uses Permit2 gasless signing — no on-chain gas needed from the user.
 */
export class LendasatBridgeProvider implements BridgeProvider {
  private chainId: number;
  private tokenAddress: string;

  constructor(config?: LendasatBridgeConfig) {
    this.chainId = config?.chainId ?? DEFAULT_CHAIN_ID;
    this.tokenAddress = config?.tokenAddress ?? DEFAULT_TOKEN_ADDRESS;
  }

  canBridge(source: RailId, target: RailId): boolean {
    return source === "x402-base" && target === "l402";
  }

  async quote(
    challenge: PaymentChallenge,
    wallet: WalletConfig,
    btcPriceUsd?: number,
  ): Promise<BridgeQuote> {
    if (challenge.type !== "l402" || wallet.type !== "evm") {
      throw new BridgePaymentFailedError(
        "x402-base->l402",
        new Error("Invalid challenge or wallet type for x402-base->l402 bridge"),
      );
    }

    const amountSats = challenge.amountSats ?? 0;
    // Heuristic fee estimate: ~1% + 100 sats (LendaSat has no standalone fee endpoint)
    const bridgeFeeSats = Math.ceil(amountSats * 0.01) + 100;
    const totalSats = amountSats + bridgeFeeSats;

    const totalCostUsd = btcPriceUsd ? (totalSats / 1e8) * btcPriceUsd : 0;
    const bridgeFeeUsd = btcPriceUsd ? (bridgeFeeSats / 1e8) * btcPriceUsd : 0;

    return {
      sourceRail: "x402-base",
      targetRail: "l402",
      totalCostUsd,
      bridgeFeeUsd,
      estimatedSeconds: 90,
    };
  }

  async execute(
    challenge: PaymentChallenge,
    wallet: WalletConfig,
    quote: BridgeQuote,
  ): Promise<BridgeResult> {
    if (challenge.type !== "l402" || wallet.type !== "evm") {
      throw new BridgePaymentFailedError(
        "x402-base->l402",
        new Error("Invalid challenge or wallet type for x402-base->l402 bridge"),
      );
    }

    const l402 = challenge as L402Challenge;
    const evmWallet = wallet as EVMWalletConfig;

    // Dynamic import — SDK is an optional peer dependency
    let Client: typeof import("@lendasat/lendaswap-sdk-pure").Client;
    let InMemoryWalletStorage: typeof import("@lendasat/lendaswap-sdk-pure").InMemoryWalletStorage;
    let InMemorySwapStorage: typeof import("@lendasat/lendaswap-sdk-pure").InMemorySwapStorage;
    try {
      const sdk = await import("@lendasat/lendaswap-sdk-pure");
      Client = sdk.Client;
      InMemoryWalletStorage = sdk.InMemoryWalletStorage;
      InMemorySwapStorage = sdk.InMemorySwapStorage;
    } catch {
      throw new BridgePaymentFailedError(
        "x402-base->l402",
        new Error(
          "Missing @lendasat/lendaswap-sdk-pure — install it with: npm install @lendasat/lendaswap-sdk-pure",
        ),
      );
    }

    // Derive EVM address from private key
    const { ethers } = await import("ethers");
    const signer = new ethers.Wallet(evmWallet.privateKey);
    const userAddress = signer.address;

    try {
      // Build LendaSat client
      const client = await Client.builder()
        .withSignerStorage(new InMemoryWalletStorage())
        .withSwapStorage(new InMemorySwapStorage())
        .build();

      // Create the swap — pass the L402 invoice directly
      const swap = await client.createEvmToLightningSwapGeneric({
        lightningInvoice: l402.invoice,
        evmChainId: this.chainId,
        tokenAddress: this.tokenAddress,
        userAddress,
        gasless: true,
      });

      // Fund via Permit2 signature (gasless)
      await client.fundSwapGasless(swap.id);

      // Poll until Lightning invoice is paid and preimage is available
      const preimage = await this.pollForPreimage(client, swap.id);

      return {
        proof: {
          type: "l402",
          macaroon: l402.macaroon,
          preimage,
        },
        actualCostUsd: quote.totalCostUsd,
      };
    } catch (err) {
      if (err instanceof BridgePaymentFailedError) throw err;
      throw new BridgePaymentFailedError("x402-base->l402", err as Error);
    }
  }

  private async pollForPreimage(
    client: import("@lendasat/lendaswap-sdk-pure").Client,
    swapId: string,
  ): Promise<string> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const status = await client.getSwap(swapId);

      if (status.lightning_paid && status.preimage) {
        return status.preimage;
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    throw new BridgePaymentFailedError(
      "x402-base->l402",
      new Error(
        `Swap ${swapId} timed out after ${POLL_TIMEOUT_MS / 1000}s waiting for Lightning payment`,
      ),
    );
  }
}
