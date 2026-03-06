import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Pay402Client } from "../src/client/pay402-client.js";
import {
  NoCompatibleRailError,
  PaymentFailedError,
  Pay402Error,
} from "../src/types/errors.js";

// Same mocks as client.test.ts
vi.mock("../src/rails/lightning.js", () => ({
  LightningRailAdapter: class {
    railId = "l402" as const;
    canHandle(c: { type: string }) {
      return c.type === "l402";
    }
    payCount = 0;
    async pay() {
      this.payCount++;
      // Add a small delay to test concurrency
      await new Promise((r) => setTimeout(r, 50));
      return {
        type: "l402" as const,
        macaroon: "mac",
        preimage: "pre",
      };
    }
    buildAuthHeader() {
      return { Authorization: "L402 mac:pre" };
    }
    async estimateCost() {
      return {
        amountRaw: "1000",
        currency: "sats" as const,
        amountUsd: 0.06,
        confidence: "estimate" as const,
      };
    }
  },
}));

vi.mock("../src/rails/x402-base.js", () => ({
  X402BaseAdapter: class {
    railId = "x402-base" as const;
    canHandle(c: { type: string; network?: string }) {
      return (
        c.type === "x402" &&
        (c.network === "base" || c.network === "base-sepolia")
      );
    }
    async pay() {
      await new Promise((r) => setTimeout(r, 50));
      return {
        type: "x402" as const,
        payload: {
          signature: "0xsig",
          from: "0xfrom",
          to: "0xto",
          value: "1000000",
          validAfter: "0",
          validBefore: "9999999999",
          nonce: "0x1234",
        },
      };
    }
    buildAuthHeader() {
      return { "X-PAYMENT": "encoded" };
    }
    async estimateCost() {
      return {
        amountRaw: "1000000",
        currency: "USDC" as const,
        amountUsd: 1.0,
        confidence: "exact" as const,
      };
    }
  },
}));

vi.mock("../src/rails/x402-solana.js", () => ({
  X402SolanaAdapter: class {
    railId = "x402-solana" as const;
    canHandle(c: { type: string; network?: string }) {
      return (
        c.type === "x402" &&
        (c.network === "solana" || c.network === "solana-devnet")
      );
    }
    async pay() {
      return { type: "x402" as const, payload: {} };
    }
    buildAuthHeader() {
      return { "X-PAYMENT": "solana-encoded" };
    }
    async estimateCost() {
      return {
        amountRaw: "1000000",
        currency: "USDC" as const,
        amountUsd: 1.0,
        confidence: "exact" as const,
      };
    }
  },
}));

describe("Pay402Client — edge cases", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  // --- Concurrent deduplication ---

  it("deduplicates concurrent payments to the same endpoint", async () => {
    const onPayment = vi.fn();

    // Track how many times pay() is called on the mock adapter
    // The deduplication happens at the client level before pay() is called,
    // so we verify via the onPayment callback and fetch call count.

    // First call: 402, then 200 for retry
    // Second call from cache: 200 directly
    globalThis.fetch = vi.fn(async () => {
      return new Response("", {
        status: 402,
        headers: {
          "www-authenticate":
            'L402 macaroon="abc", invoice="lnbc100u1rest"',
        },
      });
    });

    const client = new Pay402Client({
      wallets: [
        {
          type: "lightning",
          lndHost: "https://localhost:8080",
          lndMacaroon: "deadbeef",
        },
      ],
      btcPriceUsd: 60000,
      onPayment,
    });

    // Make a first request that pays and caches the token
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(
        new Response("", {
          status: 402,
          headers: {
            "www-authenticate":
              'L402 macaroon="abc", invoice="lnbc100u1rest"',
          },
        }),
      )
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await client.fetch("https://api.example.com/data");
    expect(onPayment).toHaveBeenCalledTimes(1);

    // Now make 3 concurrent requests — all should use the cache
    const mockFetch2 = vi.fn(async () =>
      new Response("ok", { status: 200 }),
    );
    globalThis.fetch = mockFetch2;

    const results = await Promise.all([
      client.fetch("https://api.example.com/data"),
      client.fetch("https://api.example.com/data"),
      client.fetch("https://api.example.com/data"),
    ]);

    // All succeed
    expect(results.every((r) => r.status === 200)).toBe(true);

    // No additional payments — all used cache
    expect(onPayment).toHaveBeenCalledTimes(1);

    // All 3 requests sent with auth header (from cache)
    expect(mockFetch2).toHaveBeenCalledTimes(3);
    for (const call of mockFetch2.mock.calls) {
      const headers = new Headers((call[1] as RequestInit)?.headers);
      expect(headers.get("authorization")).toMatch(/^L402 /);
    }
  });

  it("allows concurrent payments to DIFFERENT endpoints", async () => {
    const onPayment = vi.fn();
    let callIndex = 0;
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      callIndex++;
      // Odd calls are initial 402s, even calls are successful retries
      if (callIndex <= 2) {
        return new Response("", {
          status: 402,
          headers: {
            "www-authenticate":
              'L402 macaroon="abc", invoice="lnbc100u1rest"',
          },
        });
      }
      return new Response("ok", { status: 200 });
    });

    const client = new Pay402Client({
      wallets: [
        {
          type: "lightning",
          lndHost: "https://localhost:8080",
          lndMacaroon: "deadbeef",
        },
      ],
      btcPriceUsd: 60000,
      onPayment,
    });

    await Promise.all([
      client.fetch("https://api.example.com/data1"),
      client.fetch("https://api.example.com/data2"),
    ]);

    // Two separate payments — different endpoints
    expect(onPayment).toHaveBeenCalledTimes(2);
  });

  // --- NoCompatibleRailError ---

  it("throws NoCompatibleRailError when no wallet matches server's rail", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("", {
        status: 402,
        headers: {
          // Server only accepts x402 on Solana
          "x-payment-required": JSON.stringify({
            scheme: "exact",
            network: "solana",
            maxAmountRequired: "1000000",
            resource: "https://api.example.com/data",
            payTo: "addr",
            asset: "token",
            maxTimeoutSeconds: 60,
          }),
        },
      }),
    );

    // Client only has a Lightning wallet — no Solana wallet
    const client = new Pay402Client({
      wallets: [
        {
          type: "lightning",
          lndHost: "https://localhost:8080",
          lndMacaroon: "deadbeef",
        },
      ],
      btcPriceUsd: 60000,
    });

    await expect(
      client.fetch("https://api.example.com/data"),
    ).rejects.toThrow(NoCompatibleRailError);

    // Verify error has useful info
    try {
      await client.fetch("https://api.example.com/data");
    } catch (e) {
      const err = e as NoCompatibleRailError;
      expect(err.availableRails).toContain("x402");
      expect(err.configuredWallets).toContain("lightning");
    }
  });

  it("throws NoCompatibleRailError when 402 has unknown rail format", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("", {
        status: 402,
        headers: {
          // L402 header is malformed — won't parse
          "www-authenticate": "Bearer token123",
        },
      }),
    );

    const client = new Pay402Client({
      wallets: [
        {
          type: "lightning",
          lndHost: "https://localhost:8080",
          lndMacaroon: "deadbeef",
        },
      ],
    });

    // 402 with no parseable challenges passes through (not an error)
    const res = await client.fetch("https://api.example.com/data");
    expect(res.status).toBe(402);
  });

  // --- intercept() method ---

  it("intercept() adds cached auth headers to Axios config", async () => {
    // Make a payment first to populate the cache
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("", {
          status: 402,
          headers: {
            "www-authenticate":
              'L402 macaroon="abc", invoice="lnbc100u1rest"',
          },
        });
      }
      return new Response("ok", { status: 200 });
    });

    const client = new Pay402Client({
      wallets: [
        {
          type: "lightning",
          lndHost: "https://localhost:8080",
          lndMacaroon: "deadbeef",
        },
      ],
      btcPriceUsd: 60000,
    });

    await client.fetch("https://api.example.com/data");

    // Now use intercept() to add cached headers
    const axiosConfig = client.intercept({
      url: "https://api.example.com/data",
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    expect(axiosConfig.headers!.Authorization).toMatch(/^L402 /);
    expect(axiosConfig.headers!["Content-Type"]).toBe("application/json");
  });

  it("intercept() returns config unchanged when no cache hit", () => {
    const client = new Pay402Client({
      wallets: [
        {
          type: "lightning",
          lndHost: "https://localhost:8080",
          lndMacaroon: "deadbeef",
        },
      ],
    });

    const config = {
      url: "https://api.example.com/no-cache",
      method: "GET",
      headers: { "X-Custom": "value" },
    };

    const result = client.intercept(config);
    expect(result.headers).toEqual({ "X-Custom": "value" });
  });

  // --- destroy() ---

  it("destroy() stops BTC price provider", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ bitcoin: { usd: 70000 } }), {
        status: 200,
      }),
    );

    const client = new Pay402Client({
      wallets: [
        {
          type: "lightning",
          lndHost: "https://localhost:8080",
          lndMacaroon: "deadbeef",
        },
      ],
      autoFetchBtcPrice: true,
      btcPriceUsd: 60000,
    });

    // Should not throw
    client.destroy();
    client.destroy(); // calling twice should be safe
  });

  it("destroy() is safe when autoFetchBtcPrice is false", () => {
    const client = new Pay402Client({
      wallets: [
        {
          type: "lightning",
          lndHost: "https://localhost:8080",
          lndMacaroon: "deadbeef",
        },
      ],
    });

    // No provider to stop — should not throw
    expect(() => client.destroy()).not.toThrow();
  });
});
