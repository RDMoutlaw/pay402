import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchBtcPrice, createBtcPriceProvider } from "../src/price.js";

describe("fetchBtcPrice", () => {
  let originalFetch: typeof globalThis.fetch;

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it("returns price on successful fetch", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ bitcoin: { usd: 62500.42 } }), {
        status: 200,
      }),
    );

    const price = await fetchBtcPrice();
    expect(price).toBe(62500.42);
  });

  it("returns null on HTTP error", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response("error", { status: 500 }),
    );

    const price = await fetchBtcPrice();
    expect(price).toBeNull();
  });

  it("returns null on invalid response shape", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ethereum: { usd: 3000 } }), {
        status: 200,
      }),
    );

    const price = await fetchBtcPrice();
    expect(price).toBeNull();
  });

  it("returns null on network error", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    const price = await fetchBtcPrice();
    expect(price).toBeNull();
  });

  it("returns null for zero price", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ bitcoin: { usd: 0 } }), {
        status: 200,
      }),
    );

    const price = await fetchBtcPrice();
    expect(price).toBeNull();
  });
});

describe("createBtcPriceProvider", () => {
  let originalFetch: typeof globalThis.fetch;

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("uses initialPrice immediately", () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ bitcoin: { usd: 70000 } }), {
        status: 200,
      }),
    );

    const provider = createBtcPriceProvider({ initialPrice: 60000 });
    expect(provider.getPrice()).toBe(60000);
    provider.stop();
  });

  it("updates price after fetch completes", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ bitcoin: { usd: 70000 } }), {
        status: 200,
      }),
    );

    const provider = createBtcPriceProvider({ initialPrice: 60000 });
    // Wait for the async fetch to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(provider.getPrice()).toBe(70000);
    provider.stop();
  });

  it("keeps last price on fetch failure", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response("error", { status: 500 }),
    );

    const provider = createBtcPriceProvider({ initialPrice: 60000 });
    await new Promise((r) => setTimeout(r, 50));

    expect(provider.getPrice()).toBe(60000);
    provider.stop();
  });

  it("stop() prevents further refreshes", () => {
    vi.useFakeTimers();
    originalFetch = globalThis.fetch;
    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ bitcoin: { usd: 70000 } }), {
        status: 200,
      }),
    );
    globalThis.fetch = mockFetch;

    const provider = createBtcPriceProvider({
      initialPrice: 60000,
      intervalMs: 1000,
    });

    provider.stop();
    vi.advanceTimersByTime(5000);

    // Only the initial fetch should have been called (1 time)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
