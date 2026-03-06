import type { PaymentChallenge } from "./challenge.js";
import type { CostEstimate, PaymentProof, RailId } from "./payment.js";
import type { WalletConfig } from "./wallet.js";

export interface RailAdapter {
  readonly railId: RailId;
  canHandle(challenge: PaymentChallenge): boolean;
  pay(challenge: PaymentChallenge, wallet: WalletConfig): Promise<PaymentProof>;
  buildAuthHeader(proof: PaymentProof): Record<string, string>;
  estimateCost(
    challenge: PaymentChallenge,
    btcPriceUsd?: number,
  ): Promise<CostEstimate>;
}
