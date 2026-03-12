import type { PaymentChallenge } from "./challenge.js";
import type { PaymentProof, RailId } from "./payment.js";
import type { WalletConfig } from "./wallet.js";

export interface BridgeQuote {
  sourceRail: RailId;
  targetRail: RailId;
  /** Total cost including bridge fees, in USD */
  totalCostUsd: number;
  /** Bridge fee portion, in USD */
  bridgeFeeUsd: number;
  /** Estimated time for the bridge swap */
  estimatedSeconds: number;
  /** Provider-specific data */
  providerData?: unknown;
}

export interface BridgeResult {
  /** Payment proof in the TARGET rail format */
  proof: PaymentProof;
  /** Actual cost after execution, in USD */
  actualCostUsd: number;
}

export interface BridgeProvider {
  canBridge(source: RailId, target: RailId): boolean;
  quote(
    challenge: PaymentChallenge,
    wallet: WalletConfig,
    btcPriceUsd?: number,
  ): Promise<BridgeQuote>;
  execute(
    challenge: PaymentChallenge,
    wallet: WalletConfig,
    quote: BridgeQuote,
  ): Promise<BridgeResult>;
}
