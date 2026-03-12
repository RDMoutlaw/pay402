export interface L402PaymentProof {
  type: "l402";
  /** Base64url-encoded macaroon */
  macaroon: string;
  /** Hex-encoded preimage */
  preimage: string;
}

export interface X402PaymentProof {
  type: "x402";
  /** Signed payment payload to send to server */
  payload: {
    signature: string;
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
}

export interface ArkadePaymentProof {
  type: "arkade";
  txId: string;
  from: string;
}

export type PaymentProof = L402PaymentProof | X402PaymentProof | ArkadePaymentProof;

export interface CostEstimate {
  /** Amount in native units (sats or smallest USDC unit) */
  amountRaw: string;
  currency: "sats" | "USDC";
  /** Converted to USD */
  amountUsd: number;
  /** Lightning routing fees are estimates; x402 is exact */
  confidence: "exact" | "estimate";
}

export type RailId = "l402" | "x402-base" | "x402-solana" | "arkade";

export interface DryRunResult {
  rail: RailId;
  estimatedCostUsd: number;
  wouldExceedLimits: boolean;
  limitViolation?: string;
  challenge: import("./challenge.js").PaymentChallenge;
}
