import { describe, it, expect, vi, afterEach } from "vitest";
import { pay402Fetch } from "../src/client/factory.js";

// Use the same mocks as client.test.ts
vi.mock("../src/rails/lightning.js", () => ({
  LightningRailAdapter: class {
    railId = "l402" as const;
    canHandle(c: { type: string }) {
      return c.type === "l402";
    }
    async pay() {
      return { type: "l402" as const, macaroon: "mac", preimage: "pre" };
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
    canHandle() {
      return false;
    }
    async pay() {
      return { type: "x402" as const, payload: {} };
    }
    buildAuthHeader() {
      return {};
    }
    async estimateCost() {
      return {
        amountRaw: "0",
        currency: "USDC" as const,
        amountUsd: 0,
        confidence: "exact" as const,
      };
    }
  },
}));

describe("pay402Fetch", () => {
  let originalFetch: typeof globalThis.fetch;

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it("returns a function that works like fetch", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response("ok", { status: 200 }),
    );

    const fetch402 = pay402Fetch({
      wallets: [
        {
          type: "lightning",
          lndHost: "https://localhost:8080",
          lndMacaroon: "deadbeef",
        },
      ],
    });

    const res = await fetch402("https://api.example.com/free");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("handles 402 responses transparently", async () => {
    originalFetch = globalThis.fetch;
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
      return new Response("paid content", { status: 200 });
    });

    const fetch402 = pay402Fetch({
      wallets: [
        {
          type: "lightning",
          lndHost: "https://localhost:8080",
          lndMacaroon: "deadbeef",
        },
      ],
      btcPriceUsd: 60000,
    });

    const res = await fetch402("https://api.example.com/premium");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("paid content");
  });

  it("throws on invalid config", () => {
    expect(() => pay402Fetch({ wallets: [] })).toThrow(/at least one wallet/i);
  });
});
