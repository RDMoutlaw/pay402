import type { RailId } from "./payment.js";
import type { WalletConfig } from "./wallet.js";

export interface EndpointLimit {
  /** Max USD per single request to this endpoint */
  maxPerRequest?: number;
  /** Max USD per day to this endpoint */
  maxDaily?: number;
}

export interface GlobalLimits {
  /** Max USD per single request */
  maxPerRequest?: number;
  /** Max USD per rolling hour */
  maxHourly?: number;
  /** Max USD per rolling day */
  maxDaily?: number;
}

export interface SpendControlsConfig {
  /** Per-endpoint limits keyed by URL pattern (picomatch glob) */
  perEndpoint?: Record<string, EndpointLimit>;
  global?: GlobalLimits;
  /** Ordered rail preference or "cheapest" */
  railPreference?: RailId[] | "cheapest";
  /** Glob patterns — only these URLs are allowed */
  allowlist?: string[];
  /** Glob patterns — these URLs are always blocked */
  denylist?: string[];
  /** Resolve rail and estimate cost without paying */
  dryRun?: boolean;
}

export interface PaymentRecord {
  timestamp: number;
  amountUsd: number;
  endpoint: string;
  rail: RailId;
  /** Source rail if payment was bridged (e.g. "arkade" when bridging to "l402") */
  bridgedFrom?: RailId;
}

export interface Pay402ClientConfig {
  wallets: WalletConfig[];
  spendControls?: SpendControlsConfig;
  /** BTC price in USD for Lightning-to-USD conversion */
  btcPriceUsd?: number;
  /** Auto-fetch BTC price and refresh periodically (default: false) */
  autoFetchBtcPrice?: boolean;
  /** Hard ceiling for any single payment in USD (default: $10) */
  maxSinglePaymentUsd?: number;
  /** Max retries after successful payment if server still returns 402 (default: 1) */
  maxRetries?: number;
  /** Called on every successful payment for audit/observability */
  onPayment?: (record: PaymentRecord) => void;
  /** Log level: "silent", "fatal", "error", "warn", "info", "debug", "trace" */
  logLevel?: string;
  /** Cross-rail bridging configuration */
  bridging?: {
    /** Enable cross-rail bridging (default: false — strictly opt-in) */
    enabled: boolean;
    /** Max bridge fee in USD (default: $1) */
    maxBridgeFeeUsd?: number;
    /** Allowed bridge paths, e.g. ["arkade->l402"] */
    allowedPaths?: string[];
    /** LendaSat bridge config for USDC→Lightning */
    lendasat?: {
      chainId?: number;        // default: 137 (Polygon)
      tokenAddress?: string;   // default: Polygon USDC
    };
  };
}
