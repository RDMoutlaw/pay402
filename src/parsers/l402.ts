import type { L402Challenge } from "../types/challenge.js";

/**
 * BOLT11 amount suffix multipliers relative to BTC.
 * m = milli (0.001), u = micro (0.000001), n = nano, p = pico
 */
const BOLT11_MULTIPLIERS: Record<string, number> = {
  m: 1e-3,
  u: 1e-6,
  n: 1e-9,
  p: 1e-12,
};

const SATS_PER_BTC = 1e8;

/**
 * Parse amount in satoshis from a BOLT11 invoice string.
 * Returns null for zero-amount (unspecified) invoices.
 */
export function parseBolt11Amount(invoice: string): number | null {
  // BOLT11 format: ln[network][amount][multiplier]1[data]
  // Amount is digits after lnbc/lntb/lnbcrt, before the multiplier letter
  const match = invoice.match(/^ln(?:bc|tb|bcrt)(\d+)([munp])1/);
  if (!match) {
    // Could be a zero-amount invoice (no amount encoded): ln[network]1[data]
    if (/^ln(?:bc|tb|bcrt)1/.test(invoice)) {
      return null;
    }
    return null;
  }

  const amount = parseInt(match[1], 10);
  const multiplier = BOLT11_MULTIPLIERS[match[2]];
  const btcAmount = amount * multiplier;
  return Math.round(btcAmount * SATS_PER_BTC);
}

/**
 * Parse the BOLT11 invoice timestamp + expiry to get expiration date.
 * BOLT11 encodes timestamp in the data part using bech32.
 * For v1, we skip full bech32 decoding — return null (callers use default TTL).
 * TODO: Add proper bech32 BOLT11 timestamp parsing.
 */
export function parseBolt11Expiry(_invoice: string): Date | null {
  return null;
}

/**
 * Parse an L402 challenge from the WWW-Authenticate header value.
 *
 * Expected format:
 *   L402 macaroon="base64url-encoded-macaroon", invoice="BOLT11-invoice-string"
 *
 * Also handles:
 *   - LSAT prefix (older name for L402)
 *   - Unquoted values
 *   - Extra whitespace
 */
export function parseL402Header(headerValue: string): L402Challenge | null {
  const trimmed = headerValue.trim();

  // Check for L402 or LSAT prefix
  const prefixMatch = trimmed.match(/^(?:L402|LSAT)\s+/i);
  if (!prefixMatch) {
    return null;
  }

  const params = trimmed.slice(prefixMatch[0].length);

  const macaroon = extractParam(params, "macaroon");
  const invoice = extractParam(params, "invoice");

  if (!macaroon || !invoice) {
    return null;
  }

  // Validate invoice starts with known prefix
  if (!/^ln(?:bc|tb|bcrt)/.test(invoice)) {
    return null;
  }

  return {
    type: "l402",
    macaroon,
    invoice,
    amountSats: parseBolt11Amount(invoice),
    expiresAt: parseBolt11Expiry(invoice),
    rawHeader: headerValue,
  };
}

/** Extract a named parameter from a key=value or key="value" string */
function extractParam(params: string, name: string): string | null {
  // Try quoted: name="value"
  const quotedRegex = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i");
  const quotedMatch = params.match(quotedRegex);
  if (quotedMatch) {
    return quotedMatch[1];
  }

  // Try unquoted: name=value (terminated by comma, space, or end)
  const unquotedRegex = new RegExp(`${name}\\s*=\\s*([^,\\s]+)`, "i");
  const unquotedMatch = params.match(unquotedRegex);
  if (unquotedMatch) {
    return unquotedMatch[1];
  }

  return null;
}
