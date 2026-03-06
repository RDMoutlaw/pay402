import type { RailAdapter } from "../types/adapter.js";
import type { PaymentChallenge } from "../types/challenge.js";
import type {
  Pay402ClientConfig,
  PaymentRecord,
} from "../types/config.js";
import type {
  CostEstimate,
  DryRunResult,
  PaymentProof,
  RailId,
} from "../types/payment.js";
import type { WalletConfig } from "../types/wallet.js";
import {
  NoCompatibleRailError,
  PaymentFailedError,
  PaymentVerificationError,
  SpendLimitExceededError,
  Pay402Error,
} from "../types/errors.js";
import { parseChallenges } from "../parsers/index.js";
import { TokenCache } from "../cache/token-cache.js";
import { SpendControls } from "../controls/spend-controls.js";
import { LightningRailAdapter } from "../rails/lightning.js";
import { X402BaseAdapter } from "../rails/x402-base.js";
import { X402SolanaAdapter } from "../rails/x402-solana.js";
import { validateConfig } from "./validate.js";
import { createLogger, type Logger } from "../logger.js";
import { createBtcPriceProvider } from "../price.js";

const DEFAULT_MAX_SINGLE_PAYMENT_USD = 10;
const DEFAULT_MAX_RETRIES = 1;

interface PendingPayment {
  promise: Promise<PaymentProof>;
  rail: RailId;
}

export class Pay402Client {
  private cache = new TokenCache();
  private controls: SpendControls;
  private adapters: RailAdapter[];
  private wallets: WalletConfig[];
  private config: Pay402ClientConfig;
  private pending = new Map<string, PendingPayment>();
  private log: Logger;
  private btcPriceProvider?: { getPrice: () => number | undefined; stop: () => void };

  constructor(config: Pay402ClientConfig) {
    validateConfig(config);
    this.config = config;
    this.wallets = config.wallets;
    this.controls = new SpendControls(config.spendControls);
    this.log = createLogger(config.logLevel);

    // Register built-in adapters
    this.adapters = [
      new LightningRailAdapter(),
      new X402BaseAdapter(),
      new X402SolanaAdapter(),
    ];

    // Auto-fetch BTC price if configured
    if (config.autoFetchBtcPrice) {
      this.btcPriceProvider = createBtcPriceProvider({
        initialPrice: config.btcPriceUsd,
        logger: this.log,
      });
    }

    this.log.debug(
      { wallets: config.wallets.map((w) => w.type) },
      "Pay402Client initialized",
    );
  }

  /** Stop background tasks (BTC price refresh). Call when done. */
  destroy(): void {
    this.btcPriceProvider?.stop();
  }

  /**
   * Drop-in replacement for native fetch.
   * Automatically handles 402 responses by paying and retrying.
   */
  async fetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");

    // Check cache first
    const cached = this.cache.get(method, url);
    if (cached) {
      const adapter = this.adapters.find(
        (a) => a.railId === (cached.tokenType === "l402" ? "l402" : "x402-base"),
      );
      if (adapter) {
        this.log.debug({ method, url }, "Using cached payment token");
        const headers = adapter.buildAuthHeader(cached.proof);
        const retryInit = mergeHeaders(init, headers);
        return fetch(input, retryInit);
      }
    }

    // Make the initial request
    const response = await fetch(input, init);
    if (response.status !== 402) {
      return response;
    }

    // Parse challenges from 402 response
    const challenges = parseChallenges(response.headers);
    if (challenges.length === 0) {
      this.log.debug({ url }, "402 with no parseable challenges, passing through");
      return response;
    }

    this.log.info(
      { url, rails: challenges.map((c) => c.type) },
      "Received 402 challenge",
    );

    // Select the best rail
    const selection = await this.selectRail(challenges, url);

    // Estimate cost and run sanity checks
    const btcPrice = this.btcPriceProvider?.getPrice() ?? this.config.btcPriceUsd;
    const estimate = await selection.adapter.estimateCost(
      selection.challenge,
      btcPrice,
    );

    // Hard ceiling check
    const maxSingle =
      this.config.maxSinglePaymentUsd ?? DEFAULT_MAX_SINGLE_PAYMENT_USD;
    if (estimate.amountUsd > maxSingle) {
      throw new SpendLimitExceededError(
        "max single payment",
        maxSingle,
        estimate.amountUsd,
        0,
      );
    }

    // Spend control checks
    this.controls.check(url, estimate.amountUsd);

    // Dry-run mode — return estimate without paying
    if (this.controls.isDryRun) {
      const violation = this.controls.wouldExceed(url, estimate.amountUsd);
      return new Response(
        JSON.stringify({
          rail: selection.adapter.railId,
          estimatedCostUsd: estimate.amountUsd,
          wouldExceedLimits: violation !== null,
          limitViolation: violation ?? undefined,
          challenge: selection.challenge,
        } satisfies DryRunResult),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Deduplicate concurrent payments to the same endpoint
    const dedupeKey = `${method}::${url}`;
    let proof: PaymentProof;

    const existing = this.pending.get(dedupeKey);
    if (existing) {
      proof = await existing.promise;
    } else {
      const paymentPromise = selection.adapter.pay(
        selection.challenge,
        selection.wallet,
      );
      this.pending.set(dedupeKey, {
        promise: paymentPromise,
        rail: selection.adapter.railId,
      });

      try {
        proof = await paymentPromise;
      } catch (err) {
        this.pending.delete(dedupeKey);
        if (
          err instanceof PaymentFailedError ||
          err instanceof Pay402Error
        ) {
          throw err;
        }
        throw new PaymentFailedError(
          selection.adapter.railId,
          err as Error,
        );
      } finally {
        this.pending.delete(dedupeKey);
      }
    }

    // Record the payment
    const record: PaymentRecord = {
      timestamp: Date.now(),
      amountUsd: estimate.amountUsd,
      endpoint: url,
      rail: selection.adapter.railId,
    };
    this.controls.recordPayment(record);
    this.config.onPayment?.(record);
    this.log.info(
      { rail: record.rail, amountUsd: record.amountUsd, url },
      "Payment completed",
    );

    // Cache the proof
    const ttlMs =
      selection.challenge.type === "x402"
        ? selection.challenge.maxTimeoutSeconds * 1000
        : undefined;
    this.cache.set(method, url, proof, ttlMs);

    // Retry with payment proof
    const authHeaders = selection.adapter.buildAuthHeader(proof);
    const retryInit = mergeHeaders(init, authHeaders);
    const retryResponse = await fetch(input, retryInit);

    // If still 402 after payment, something is wrong
    const maxRetries = this.config.maxRetries ?? DEFAULT_MAX_RETRIES;
    if (retryResponse.status === 402 && maxRetries <= 1) {
      this.cache.delete(method, url);
      throw new PaymentVerificationError(
        selection.adapter.railId,
        retryResponse.status,
      );
    }

    return retryResponse;
  }

  /**
   * Axios interceptor-compatible method.
   */
  intercept(config: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
  }) {
    const url = config.url ?? "";
    const method = (config.method ?? "GET").toUpperCase();

    const cached = this.cache.get(method, url);
    if (cached) {
      const adapter = this.adapters.find(
        (a) =>
          a.railId === (cached.tokenType === "l402" ? "l402" : "x402-base"),
      );
      if (adapter) {
        const headers = adapter.buildAuthHeader(cached.proof);
        config.headers = { ...config.headers, ...headers };
      }
    }

    return config;
  }

  private async selectRail(
    challenges: PaymentChallenge[],
    url: string,
  ): Promise<{
    adapter: RailAdapter;
    wallet: WalletConfig;
    challenge: PaymentChallenge;
    estimate: CostEstimate;
  }> {
    const preference = this.controls.railPreference;

    if (preference === "cheapest") {
      return this.selectCheapestRail(challenges);
    }

    // Ordered preference
    for (const railId of preference) {
      const adapter = this.adapters.find((a) => a.railId === railId);
      if (!adapter) continue;

      const challenge = challenges.find((c) => adapter.canHandle(c));
      if (!challenge) continue;

      const wallet = this.findWallet(railId);
      if (!wallet) continue;

      const estimate = await adapter.estimateCost(
        challenge,
        this.btcPriceProvider?.getPrice() ?? this.config.btcPriceUsd,
      );
      return { adapter, wallet, challenge, estimate };
    }

    throw new NoCompatibleRailError(
      challenges.map((c) => c.type),
      this.wallets.map((w) => w.type),
    );
  }

  private async selectCheapestRail(
    challenges: PaymentChallenge[],
  ): Promise<{
    adapter: RailAdapter;
    wallet: WalletConfig;
    challenge: PaymentChallenge;
    estimate: CostEstimate;
  }> {
    const candidates: Array<{
      adapter: RailAdapter;
      wallet: WalletConfig;
      challenge: PaymentChallenge;
      estimate: CostEstimate;
    }> = [];

    for (const challenge of challenges) {
      for (const adapter of this.adapters) {
        if (!adapter.canHandle(challenge)) continue;
        const wallet = this.findWallet(adapter.railId);
        if (!wallet) continue;

        const estimate = await adapter.estimateCost(
          challenge,
          this.btcPriceProvider?.getPrice() ?? this.config.btcPriceUsd,
        );
        candidates.push({ adapter, wallet, challenge, estimate });
      }
    }

    if (candidates.length === 0) {
      throw new NoCompatibleRailError(
        challenges.map((c) => c.type),
        this.wallets.map((w) => w.type),
      );
    }

    candidates.sort((a, b) => a.estimate.amountUsd - b.estimate.amountUsd);
    return candidates[0];
  }

  private findWallet(railId: RailId): WalletConfig | undefined {
    switch (railId) {
      case "l402":
        return this.wallets.find((w) => w.type === "lightning");
      case "x402-base":
        return this.wallets.find((w) => w.type === "evm");
      case "x402-solana":
        return this.wallets.find((w) => w.type === "solana");
    }
  }
}

function mergeHeaders(
  init: RequestInit | undefined,
  extra: Record<string, string>,
): RequestInit {
  const existing = new Headers(init?.headers);
  for (const [k, v] of Object.entries(extra)) {
    existing.set(k, v);
  }
  return { ...init, headers: existing };
}
