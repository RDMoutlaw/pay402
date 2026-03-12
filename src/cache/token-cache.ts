import type { PaymentProof, RailId } from "../types/payment.js";

interface CacheEntry {
  railId: RailId;
  token: string;
  expiresAt: number;
  proof: PaymentProof;
}

const DEFAULT_L402_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * In-memory token cache keyed by method + URL.
 * Caches payment proofs to avoid re-paying for the same resource.
 */
export class TokenCache {
  private store = new Map<string, CacheEntry>();

  private key(method: string, url: string): string {
    return `${method.toUpperCase()}::${url}`;
  }

  set(
    method: string,
    url: string,
    proof: PaymentProof,
    ttlMs?: number,
  ): void {
    const key = this.key(method, url);

    if (proof.type === "l402") {
      this.store.set(key, {
        railId: "l402",
        token: `${proof.macaroon}:${proof.preimage}`,
        expiresAt: Date.now() + (ttlMs ?? DEFAULT_L402_TTL_MS),
        proof,
      });
    } else if (proof.type === "x402") {
      this.store.set(key, {
        railId: "x402-base", // x402 proof doesn't distinguish base vs solana; stored generically
        token: btoa(JSON.stringify(proof.payload)),
        expiresAt: Date.now() + (ttlMs ?? 30_000),
        proof,
      });
    } else if (proof.type === "arkade") {
      this.store.set(key, {
        railId: "arkade",
        token: btoa(JSON.stringify({ txId: proof.txId, from: proof.from })),
        expiresAt: Date.now() + (ttlMs ?? DEFAULT_L402_TTL_MS),
        proof,
      });
    }
  }

  get(method: string, url: string): CacheEntry | null {
    const key = this.key(method, url);
    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry;
  }

  delete(method: string, url: string): boolean {
    return this.store.delete(this.key(method, url));
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
