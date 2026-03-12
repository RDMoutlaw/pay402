export interface L402Challenge {
  type: "l402";
  /** Base64url-encoded macaroon from WWW-Authenticate header */
  macaroon: string;
  /** BOLT11 invoice string */
  invoice: string;
  /** Amount in satoshis, parsed from BOLT11 */
  amountSats: number | null;
  /** Invoice expiry timestamp, parsed from BOLT11 */
  expiresAt: Date | null;
  /** Raw header value for debugging */
  rawHeader: string;
}

export interface X402Challenge {
  type: "x402";
  scheme: "exact";
  network: "base" | "base-sepolia" | "solana" | "solana-devnet";
  /** Amount in smallest unit (e.g. 1000000 = 1 USDC) */
  maxAmountRequired: string;
  /** The gated URL */
  resource: string;
  /** Recipient address */
  payTo: string;
  /** Token contract address */
  asset: string;
  /** How long server waits for payment */
  maxTimeoutSeconds: number;
  /** Optional metadata (token name, EIP-3009 version, etc.) */
  extra?: Record<string, unknown>;
  /** Facilitator URL override from the server challenge */
  facilitatorUrl?: string;
  /** Raw header value for debugging */
  rawHeader: string;
}

export interface ArkadeChallenge {
  type: "arkade";
  /** ark1... recipient address */
  payTo: string;
  /** Amount in satoshis */
  amountSats: number;
  /** How long server waits for payment */
  maxTimeoutSeconds?: number;
  /** Raw header value for debugging */
  rawHeader: string;
}

export type PaymentChallenge = L402Challenge | X402Challenge | ArkadeChallenge;
