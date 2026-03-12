import type { ArkadeChallenge } from "../types/challenge.js";

/**
 * Parse an Arkade payment challenge from the X-Arkade-Payment header.
 * Expected format: JSON with { payTo, amountSats, maxTimeoutSeconds? }
 */
export function parseArkadeHeader(
  headerValue: string,
): ArkadeChallenge | null {
  try {
    const parsed = JSON.parse(headerValue);

    if (typeof parsed !== "object" || parsed === null) return null;

    const { payTo, amountSats, maxTimeoutSeconds } = parsed;

    // Validate payTo starts with ark1
    if (typeof payTo !== "string" || !payTo.startsWith("ark1")) return null;

    // Validate amountSats is a positive number
    if (typeof amountSats !== "number" || amountSats <= 0 || !Number.isFinite(amountSats)) {
      return null;
    }

    return {
      type: "arkade",
      payTo,
      amountSats,
      maxTimeoutSeconds:
        typeof maxTimeoutSeconds === "number" && maxTimeoutSeconds > 0
          ? maxTimeoutSeconds
          : undefined,
      rawHeader: headerValue,
    };
  } catch {
    return null;
  }
}
