import type { X402Challenge } from "../types/challenge.js";

const VALID_NETWORKS = new Set([
  "base",
  "base-sepolia",
  "solana",
  "solana-devnet",
]);

/**
 * Parse an x402 challenge from the X-Payment-Required header value.
 *
 * The header contains a JSON string with fields:
 *   scheme, network, maxAmountRequired, resource, payTo, asset,
 *   maxTimeoutSeconds, extra (optional)
 */
export function parseX402Header(headerValue: string): X402Challenge | null {
  const trimmed = headerValue.trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const {
    scheme,
    network,
    maxAmountRequired,
    resource,
    payTo,
    asset,
    maxTimeoutSeconds,
    extra,
  } = parsed as Record<string, unknown>;

  // Validate required fields
  if (scheme !== "exact") return null;
  if (typeof network !== "string" || !VALID_NETWORKS.has(network)) return null;
  if (typeof maxAmountRequired !== "string") return null;
  if (typeof resource !== "string") return null;
  if (typeof payTo !== "string") return null;
  if (typeof asset !== "string") return null;
  if (typeof maxTimeoutSeconds !== "number" || maxTimeoutSeconds <= 0)
    return null;

  return {
    type: "x402",
    scheme: "exact",
    network: network as X402Challenge["network"],
    maxAmountRequired,
    resource,
    payTo,
    asset,
    maxTimeoutSeconds,
    extra: extra as Record<string, unknown> | undefined,
    rawHeader: headerValue,
  };
}
