import type { Request, Response, NextFunction } from "express";

export interface MiddlewarePricing {
  /** Price in sats for L402 rail */
  l402?: number;
  /** Price in smallest USDC unit for x402 rail */
  x402?: number;
  /** Price in sats for Arkade rail */
  arkade?: number;
}

export interface Pay402MiddlewareConfig {
  /** Per-route pricing: route pattern -> pricing */
  pricing: Record<string, MiddlewarePricing>;
  /** Which rails this server accepts */
  acceptedRails: Array<"l402" | "x402" | "arkade">;
  /** Verify an L402 payment proof. Returns true if valid. */
  verifyL402?: (macaroon: string, preimage: string) => boolean | Promise<boolean>;
  /** Verify an x402 payment proof. Returns true if valid. */
  verifyX402?: (payload: Record<string, unknown>) => boolean | Promise<boolean>;
  /** Verify an Arkade payment proof. Returns true if valid. */
  verifyArkade?: (proof: { txId: string; from: string }) => boolean | Promise<boolean>;
  /** Called after successful payment verification */
  onPaymentReceived?: (info: {
    rail: string;
    route: string;
    amount: number;
  }) => void;
  /** Network for x402 challenges (default: "base") */
  x402Network?: "base" | "base-sepolia" | "solana" | "solana-devnet";
  /** Recipient address for x402 payments */
  x402PayTo?: string;
  /** USDC token contract address */
  x402Asset?: string;
  /** Max timeout for x402 payments in seconds (default: 60) */
  x402MaxTimeout?: number;
  /** Arkade recipient address (ark1...) */
  arkadePayTo?: string;
}

/**
 * Express middleware that gates routes behind HTTP 402 Payment Required.
 * Advertises ALL accepted rails in the 402 response.
 */
export function pay402Middleware(config: Pay402MiddlewareConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Find pricing for this route
    const pricing = findPricing(config.pricing, req.path);
    if (!pricing) {
      return next(); // No pricing for this route, pass through
    }

    // Check for existing payment proof
    const authHeader = req.headers.authorization;
    const xPaymentHeader = req.headers["x-payment"] as string | undefined;

    // Try L402 verification
    if (authHeader && config.acceptedRails.includes("l402")) {
      const l402Match = authHeader.match(/^L402\s+(\S+):(\S+)$/i);
      if (l402Match && config.verifyL402) {
        const [, macaroon, preimage] = l402Match;
        const valid = await config.verifyL402(macaroon, preimage);
        if (valid) {
          config.onPaymentReceived?.({
            rail: "l402",
            route: req.path,
            amount: pricing.l402 ?? 0,
          });
          return next();
        }
        return res.status(401).json({ error: "Invalid L402 payment proof" });
      }
    }

    // Try Arkade verification
    const arkadeProofHeader = req.headers["x-arkade-payment-proof"] as string | undefined;
    if (arkadeProofHeader && config.acceptedRails.includes("arkade")) {
      if (config.verifyArkade) {
        let proof: { txId: string; from: string };
        try {
          proof = JSON.parse(
            Buffer.from(arkadeProofHeader, "base64").toString("utf-8"),
          );
        } catch {
          return res.status(401).json({ error: "Invalid X-Arkade-Payment-Proof header" });
        }

        const valid = await config.verifyArkade(proof);
        if (valid) {
          config.onPaymentReceived?.({
            rail: "arkade",
            route: req.path,
            amount: pricing.arkade ?? 0,
          });
          return next();
        }
        return res.status(401).json({ error: "Invalid Arkade payment proof" });
      }
    }

    // Try x402 verification
    if (xPaymentHeader && config.acceptedRails.includes("x402")) {
      if (config.verifyX402) {
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(
            Buffer.from(xPaymentHeader, "base64").toString("utf-8"),
          );
        } catch {
          return res.status(401).json({ error: "Invalid X-PAYMENT header" });
        }

        const valid = await config.verifyX402(payload);
        if (valid) {
          config.onPaymentReceived?.({
            rail: "x402",
            route: req.path,
            amount: pricing.x402 ?? 0,
          });
          return next();
        }
        return res.status(401).json({ error: "Invalid x402 payment proof" });
      }
    }

    // No valid payment — return 402 with challenge headers for ALL accepted rails
    res.status(402);

    if (config.acceptedRails.includes("l402") && pricing.l402) {
      // In production, the server would generate a real macaroon and BOLT11 invoice.
      // This middleware provides the structure; invoice generation is the server's responsibility.
      res.setHeader(
        "WWW-Authenticate",
        `L402 macaroon="server-must-set", invoice="server-must-set"`,
      );
    }

    if (config.acceptedRails.includes("x402") && pricing.x402) {
      const challenge = {
        scheme: "exact",
        network: config.x402Network ?? "base",
        maxAmountRequired: String(pricing.x402),
        resource: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
        payTo: config.x402PayTo ?? "",
        asset: config.x402Asset ?? "",
        maxTimeoutSeconds: config.x402MaxTimeout ?? 60,
      };
      res.setHeader("X-Payment-Required", JSON.stringify(challenge));
    }

    if (config.acceptedRails.includes("arkade") && pricing.arkade) {
      const challenge = {
        payTo: config.arkadePayTo ?? "",
        amountSats: pricing.arkade,
        maxTimeoutSeconds: config.x402MaxTimeout ?? 60,
      };
      res.setHeader("X-Arkade-Payment", JSON.stringify(challenge));
    }

    return res.json({
      error: "Payment Required",
      acceptedRails: config.acceptedRails,
    });
  };
}

function findPricing(
  pricing: Record<string, MiddlewarePricing>,
  path: string,
): MiddlewarePricing | null {
  // Exact match first
  if (pricing[path]) return pricing[path];

  // Try prefix matching with wildcards
  for (const [pattern, price] of Object.entries(pricing)) {
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      if (path.startsWith(prefix)) return price;
    }
  }

  return null;
}
