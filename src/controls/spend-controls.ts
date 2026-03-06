import picomatch from "picomatch";
import type {
  EndpointLimit,
  PaymentRecord,
  SpendControlsConfig,
} from "../types/config.js";
import type { RailId } from "../types/payment.js";
import { Pay402Error, SpendLimitExceededError } from "../types/errors.js";

export class SpendControls {
  private records: PaymentRecord[] = [];
  private config: SpendControlsConfig;

  constructor(config: SpendControlsConfig = {}) {
    this.config = config;
  }

  recordPayment(record: PaymentRecord): void {
    this.records.push(record);
  }

  /**
   * Run all spend control checks BEFORE payment.
   * Throws SpendLimitExceededError or Pay402Error if any check fails.
   */
  check(url: string, amountUsd: number): void {
    // 1. Denylist
    if (this.config.denylist?.length) {
      for (const pattern of this.config.denylist) {
        if (picomatch(pattern)(url)) {
          throw new Pay402Error(`URL blocked by denylist: ${pattern}`);
        }
      }
    }

    // 2. Allowlist
    if (this.config.allowlist?.length) {
      const allowed = this.config.allowlist.some((pattern) =>
        picomatch(pattern)(url),
      );
      if (!allowed) {
        throw new Pay402Error("URL not in allowlist");
      }
    }

    const now = Date.now();

    // 3. Per-endpoint limits
    if (this.config.perEndpoint) {
      for (const [pattern, limits] of Object.entries(
        this.config.perEndpoint,
      )) {
        if (!picomatch(pattern)(url)) continue;
        this.checkEndpointLimits(url, limits, amountUsd, now);
      }
    }

    // 4. Global per-request
    if (
      this.config.global?.maxPerRequest !== undefined &&
      amountUsd > this.config.global.maxPerRequest
    ) {
      throw new SpendLimitExceededError(
        "global per-request",
        this.config.global.maxPerRequest,
        amountUsd,
        0,
      );
    }

    // 5. Global hourly
    if (this.config.global?.maxHourly !== undefined) {
      const hourlySpend = this.sumSpendSince(now - 3_600_000);
      if (hourlySpend + amountUsd > this.config.global.maxHourly) {
        throw new SpendLimitExceededError(
          "global hourly",
          this.config.global.maxHourly,
          amountUsd,
          hourlySpend,
        );
      }
    }

    // 6. Global daily
    if (this.config.global?.maxDaily !== undefined) {
      const dailySpend = this.sumSpendSince(now - 86_400_000);
      if (dailySpend + amountUsd > this.config.global.maxDaily) {
        throw new SpendLimitExceededError(
          "global daily",
          this.config.global.maxDaily,
          amountUsd,
          dailySpend,
        );
      }
    }
  }

  /**
   * Check if limits WOULD be exceeded, without throwing.
   * Returns the first violated limit name, or null if all pass.
   */
  wouldExceed(url: string, amountUsd: number): string | null {
    try {
      this.check(url, amountUsd);
      return null;
    } catch (e) {
      if (e instanceof SpendLimitExceededError) {
        return e.limitType;
      }
      if (e instanceof Pay402Error) {
        return e.message;
      }
      throw e;
    }
  }

  /**
   * Get the preferred rail ordering based on config.
   */
  get railPreference(): RailId[] | "cheapest" {
    return this.config.railPreference ?? ["l402", "x402-base", "x402-solana"];
  }

  get isDryRun(): boolean {
    return this.config.dryRun ?? false;
  }

  private checkEndpointLimits(
    url: string,
    limits: EndpointLimit,
    amountUsd: number,
    now: number,
  ): void {
    if (
      limits.maxPerRequest !== undefined &&
      amountUsd > limits.maxPerRequest
    ) {
      throw new SpendLimitExceededError(
        `per-endpoint per-request (${url})`,
        limits.maxPerRequest,
        amountUsd,
        0,
      );
    }

    if (limits.maxDaily !== undefined) {
      const dailySpend = this.sumSpendForEndpointSince(url, now - 86_400_000);
      if (dailySpend + amountUsd > limits.maxDaily) {
        throw new SpendLimitExceededError(
          `per-endpoint daily (${url})`,
          limits.maxDaily,
          amountUsd,
          dailySpend,
        );
      }
    }
  }

  private sumSpendSince(since: number): number {
    let total = 0;
    for (let i = this.records.length - 1; i >= 0; i--) {
      if (this.records[i].timestamp < since) break;
      total += this.records[i].amountUsd;
    }
    return total;
  }

  private sumSpendForEndpointSince(url: string, since: number): number {
    let total = 0;
    for (let i = this.records.length - 1; i >= 0; i--) {
      if (this.records[i].timestamp < since) break;
      if (this.records[i].endpoint === url) {
        total += this.records[i].amountUsd;
      }
    }
    return total;
  }
}
