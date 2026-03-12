import type { BridgeProvider, BridgeQuote, BridgeResult } from "../types/bridge.js";
import type { PaymentChallenge, L402Challenge } from "../types/challenge.js";
import type { RailId } from "../types/payment.js";
import type { WalletConfig, ArkadeWalletConfig } from "../types/wallet.js";
import { BridgePaymentFailedError } from "../types/errors.js";
import { getOrCreateArkadeWallet } from "../rails/arkade.js";

/**
 * Bridge provider for Arkade → L402 (Lightning) via Boltz submarine swap.
 * Uses an Arkade wallet to fund a Lightning payment through Boltz swaps.
 */
export class ArkadeBridgeProvider implements BridgeProvider {
  canBridge(source: RailId, target: RailId): boolean {
    return source === "arkade" && target === "l402";
  }

  async quote(
    challenge: PaymentChallenge,
    wallet: WalletConfig,
    btcPriceUsd?: number,
  ): Promise<BridgeQuote> {
    if (challenge.type !== "l402" || wallet.type !== "arkade") {
      throw new BridgePaymentFailedError(
        "arkade->l402",
        new Error("Invalid challenge or wallet type for arkade->l402 bridge"),
      );
    }

    const arkWallet = await getOrCreateArkadeWallet(wallet);

    let BoltzSwaps: typeof import("@arkade-os/boltz-swap").ArkadeSwaps;
    try {
      const boltz = await import("@arkade-os/boltz-swap");
      BoltzSwaps = boltz.ArkadeSwaps;
    } catch {
      throw new BridgePaymentFailedError(
        "arkade->l402",
        new Error(
          "Missing @arkade-os/boltz-swap — install it with: npm install @arkade-os/boltz-swap",
        ),
      );
    }

    const swaps = new BoltzSwaps(arkWallet);
    const fees = await swaps.getFees();

    const amountSats = challenge.amountSats ?? 0;
    const bridgeFeeSats = fees.totalEstimate;
    const totalSats = amountSats + bridgeFeeSats;

    const totalCostUsd = btcPriceUsd ? (totalSats / 1e8) * btcPriceUsd : 0;
    const bridgeFeeUsd = btcPriceUsd ? (bridgeFeeSats / 1e8) * btcPriceUsd : 0;

    return {
      sourceRail: "arkade",
      targetRail: "l402",
      totalCostUsd,
      bridgeFeeUsd,
      estimatedSeconds: 30,
      providerData: { fees },
    };
  }

  async execute(
    challenge: PaymentChallenge,
    wallet: WalletConfig,
    quote: BridgeQuote,
  ): Promise<BridgeResult> {
    if (challenge.type !== "l402" || wallet.type !== "arkade") {
      throw new BridgePaymentFailedError(
        "arkade->l402",
        new Error("Invalid challenge or wallet type for arkade->l402 bridge"),
      );
    }

    const arkWallet = await getOrCreateArkadeWallet(wallet as ArkadeWalletConfig);

    let BoltzSwaps: typeof import("@arkade-os/boltz-swap").ArkadeSwaps;
    try {
      const boltz = await import("@arkade-os/boltz-swap");
      BoltzSwaps = boltz.ArkadeSwaps;
    } catch {
      throw new BridgePaymentFailedError(
        "arkade->l402",
        new Error(
          "Missing @arkade-os/boltz-swap — install it with: npm install @arkade-os/boltz-swap",
        ),
      );
    }

    const swaps = new BoltzSwaps(arkWallet);

    try {
      const result = await swaps.sendLightningPayment(
        (challenge as L402Challenge).invoice,
      );

      // Return an L402 proof — the server sees a valid preimage, not the bridge
      return {
        proof: {
          type: "l402",
          macaroon: (challenge as L402Challenge).macaroon,
          preimage: result.preimage,
        },
        actualCostUsd: quote.totalCostUsd,
      };
    } catch (err) {
      throw new BridgePaymentFailedError("arkade->l402", err as Error);
    }
  }
}
