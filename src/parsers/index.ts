import type { PaymentChallenge } from "../types/challenge.js";
import { parseL402Header } from "./l402.js";
import { parseX402Header } from "./x402.js";

export { parseL402Header } from "./l402.js";
export { parseX402Header } from "./x402.js";
export { parseBolt11Amount } from "./l402.js";

/**
 * Parse all payment challenges from a 402 response.
 * Checks both WWW-Authenticate (L402) and X-Payment-Required (x402) headers.
 */
export function parseChallenges(headers: Headers): PaymentChallenge[] {
  const challenges: PaymentChallenge[] = [];

  // Check for L402 in WWW-Authenticate
  const wwwAuth = headers.get("www-authenticate");
  if (wwwAuth) {
    const l402 = parseL402Header(wwwAuth);
    if (l402) {
      challenges.push(l402);
    }
  }

  // Check for x402 in X-Payment-Required or Payment-Required (v2 spec)
  const xPayment =
    headers.get("x-payment-required") ?? headers.get("payment-required");
  if (xPayment) {
    const x402 = parseX402Header(xPayment);
    if (x402) {
      challenges.push(x402);
    }
  }

  return challenges;
}
