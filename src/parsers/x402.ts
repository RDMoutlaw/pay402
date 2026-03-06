import type { X402Challenge } from "../types/challenge.js";

const VALID_NETWORKS = new Set([
  "base",
  "base-sepolia",
  "solana",
  "solana-devnet",
]);

/** Map CAIP-2 network identifiers to our short network names */
const CAIP2_NETWORK_MAP: Record<string, X402Challenge["network"]> = {
  "eip155:8453": "base",
  "eip155:84532": "base-sepolia",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "solana",
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "solana-devnet",
};

function normalizeNetwork(network: string): X402Challenge["network"] | null {
  if (VALID_NETWORKS.has(network)) {
    return network as X402Challenge["network"];
  }
  return CAIP2_NETWORK_MAP[network] ?? null;
}

/**
 * Try to decode a base64-encoded string, returning null on failure.
 */
function tryBase64Decode(value: string): string | null {
  try {
    return atob(value);
  } catch {
    return null;
  }
}

/**
 * Parse an x402 challenge from a header value.
 *
 * Supports two formats:
 * 1. Simple JSON: { scheme, network, maxAmountRequired, resource, payTo, asset, maxTimeoutSeconds, extra? }
 * 2. x402 v2 (base64-encoded JSON with nested accepts array):
 *    { accepts: [{ scheme, network, maxAmountRequired|amount, ... }], ... }
 */
export function parseX402Header(headerValue: string): X402Challenge | null {
  const trimmed = headerValue.trim();

  // Try plain JSON first, then base64-decoded JSON
  let jsonStr = trimmed;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    const decoded = tryBase64Decode(trimmed);
    if (!decoded) return null;
    jsonStr = decoded;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return null;
    }
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  // x402 v2: nested structure with accepts array
  if (Array.isArray(parsed.accepts) && parsed.accepts.length > 0) {
    return parseV2Challenge(parsed, headerValue);
  }

  // Simple format (v1)
  return parseV1Challenge(parsed, headerValue);
}

/**
 * Parse simple (v1) x402 challenge format.
 */
function parseV1Challenge(
  parsed: Record<string, unknown>,
  rawHeader: string,
): X402Challenge | null {
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

  if (scheme !== "exact") return null;
  if (typeof network !== "string") return null;
  const normalizedNetwork = normalizeNetwork(network);
  if (!normalizedNetwork) return null;
  if (typeof maxAmountRequired !== "string") return null;
  if (typeof resource !== "string") return null;
  if (typeof payTo !== "string") return null;
  if (typeof asset !== "string") return null;
  if (typeof maxTimeoutSeconds !== "number" || maxTimeoutSeconds <= 0)
    return null;

  return {
    type: "x402",
    scheme: "exact",
    network: normalizedNetwork,
    maxAmountRequired,
    resource,
    payTo,
    asset,
    maxTimeoutSeconds,
    extra: extra as Record<string, unknown> | undefined,
    rawHeader,
  };
}

/**
 * Parse x402 v2 challenge format (nested accepts array).
 * Picks the first accepted payment option we can handle.
 */
function parseV2Challenge(
  parsed: Record<string, unknown>,
  rawHeader: string,
): X402Challenge | null {
  const accepts = parsed.accepts as Record<string, unknown>[];

  for (const option of accepts) {
    const scheme = option.scheme ?? option.type;
    if (scheme !== "exact") continue;

    const network = option.network as string | undefined;
    if (typeof network !== "string") continue;
    const normalizedNetwork = normalizeNetwork(network);
    if (!normalizedNetwork) continue;

    // v2 uses "amount", fall back to "maxAmountRequired"
    const amount = (option.amount ?? option.maxAmountRequired) as
      | string
      | number
      | undefined;
    if (amount === undefined) continue;
    const maxAmountRequired = String(amount);

    const resource = (option.resource ?? parsed.resource) as string | undefined;
    const payTo = (option.payTo ?? option.address) as string | undefined;
    const asset = (option.asset ?? option.token) as string | undefined;
    const maxTimeoutSeconds = (option.maxTimeoutSeconds ??
      option.timeout ??
      60) as number;

    if (typeof resource !== "string") continue;
    if (typeof payTo !== "string") continue;
    if (typeof asset !== "string") continue;

    const extra = option.extra as Record<string, unknown> | undefined;

    return {
      type: "x402",
      scheme: "exact",
      network: normalizedNetwork,
      maxAmountRequired,
      resource,
      payTo,
      asset,
      maxTimeoutSeconds,
      extra,
      rawHeader,
    };
  }

  return null;
}
