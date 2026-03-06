import type { RailAdapter } from "../types/adapter.js";
import type { PaymentChallenge, L402Challenge } from "../types/challenge.js";
import type { CostEstimate, PaymentProof } from "../types/payment.js";
import type { WalletConfig, LightningWalletConfig } from "../types/wallet.js";
import {
  InvoiceExpiredError,
  PaymentFailedError,
  PaymentInFlightError,
} from "../types/errors.js";

interface LndSendResponse {
  result?: {
    status: "SUCCEEDED" | "FAILED" | "IN_FLIGHT";
    payment_preimage?: string;
    failure_reason?: string;
  };
  error?: { message: string };
}

interface LndRouteResponse {
  routes?: Array<{
    total_fees_msat?: string;
  }>;
}

export class LightningRailAdapter implements RailAdapter {
  readonly railId = "l402" as const;

  canHandle(challenge: PaymentChallenge): boolean {
    return challenge.type === "l402";
  }

  async pay(
    challenge: PaymentChallenge,
    wallet: WalletConfig,
  ): Promise<PaymentProof> {
    if (challenge.type !== "l402") {
      throw new PaymentFailedError("l402", new Error("Not an L402 challenge"));
    }
    if (wallet.type !== "lightning") {
      throw new PaymentFailedError(
        "l402",
        new Error("Not a Lightning wallet"),
      );
    }

    // Check invoice expiry before paying
    if (challenge.expiresAt && challenge.expiresAt.getTime() < Date.now()) {
      throw new InvoiceExpiredError(challenge.expiresAt, new Date());
    }

    const preimage = await this.sendPayment(challenge, wallet);

    return {
      type: "l402",
      macaroon: challenge.macaroon,
      preimage,
    };
  }

  buildAuthHeader(proof: PaymentProof): Record<string, string> {
    if (proof.type !== "l402") {
      throw new Error("Not an L402 proof");
    }
    // Both macaroon and preimage are base64url-encoded in the header
    return {
      Authorization: `L402 ${proof.macaroon}:${proof.preimage}`,
    };
  }

  async estimateCost(
    challenge: PaymentChallenge,
    btcPriceUsd?: number,
  ): Promise<CostEstimate> {
    if (challenge.type !== "l402") {
      throw new Error("Not an L402 challenge");
    }

    const amountSats = challenge.amountSats ?? 0;
    const amountUsd = btcPriceUsd
      ? (amountSats / 1e8) * btcPriceUsd
      : 0;

    return {
      amountRaw: String(amountSats),
      currency: "sats",
      amountUsd,
      confidence: "estimate", // routing fees are unknown
    };
  }

  private async sendPayment(
    challenge: L402Challenge,
    wallet: LightningWalletConfig,
  ): Promise<string> {
    const url = `${wallet.lndHost}/v2/router/send`;

    const headers: Record<string, string> = {
      "Grpc-Metadata-macaroon": wallet.lndMacaroon,
      "Content-Type": "application/json",
    };

    const body = JSON.stringify({
      payment_request: challenge.invoice,
      timeout_seconds: 60,
      fee_limit_sat: "100", // reasonable default fee limit
    });

    const fetchOptions: RequestInit = {
      method: "POST",
      headers,
      body,
    };

    // For self-signed LND nodes, TLS cert handling would go here.
    // Node.js native fetch doesn't support custom CAs directly —
    // users with self-signed certs should use NODE_TLS_REJECT_UNAUTHORIZED
    // or a custom agent in production.

    let response: Response;
    try {
      response = await fetch(url, fetchOptions);
    } catch (err) {
      throw new PaymentFailedError(
        "l402",
        new Error(`LND connection failed: ${(err as Error).message}`),
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "unknown error");
      throw new PaymentFailedError(
        "l402",
        new Error(`LND returned ${response.status}: ${text}`),
      );
    }

    // LND streaming endpoint returns newline-delimited JSON
    const text = await response.text();
    const lines = text.trim().split("\n");
    const lastLine = lines[lines.length - 1];

    let result: LndSendResponse;
    try {
      result = JSON.parse(lastLine);
    } catch {
      throw new PaymentFailedError(
        "l402",
        new Error(`Invalid LND response: ${lastLine}`),
      );
    }

    if (result.error) {
      throw new PaymentFailedError(
        "l402",
        new Error(`LND error: ${result.error.message}`),
      );
    }

    if (!result.result) {
      throw new PaymentFailedError(
        "l402",
        new Error("LND returned empty result"),
      );
    }

    switch (result.result.status) {
      case "SUCCEEDED":
        if (!result.result.payment_preimage) {
          throw new PaymentFailedError(
            "l402",
            new Error("LND returned SUCCEEDED but no preimage"),
          );
        }
        return result.result.payment_preimage;

      case "IN_FLIGHT":
        throw new PaymentInFlightError("l402");

      case "FAILED":
        throw new PaymentFailedError(
          "l402",
          new Error(
            `Payment failed: ${result.result.failure_reason ?? "unknown"}`,
          ),
        );

      default:
        throw new PaymentFailedError(
          "l402",
          new Error(`Unknown payment status: ${result.result.status}`),
        );
    }
  }
}
