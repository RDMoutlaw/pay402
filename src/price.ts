import type { Logger } from "./logger.js";

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";

/**
 * Fetch current BTC price in USD from CoinGecko.
 * Returns null on failure — callers should fall back to configured btcPriceUsd.
 */
export async function fetchBtcPrice(logger?: Logger): Promise<number | null> {
  try {
    const res = await fetch(COINGECKO_URL, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logger?.warn(`BTC price fetch failed: ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { bitcoin?: { usd?: number } };
    const price = data.bitcoin?.usd;
    if (typeof price !== "number" || price <= 0) {
      logger?.warn("BTC price fetch returned invalid data");
      return null;
    }
    logger?.debug(`BTC price fetched: $${price}`);
    return price;
  } catch (err) {
    logger?.warn(`BTC price fetch error: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Creates a self-refreshing BTC price provider.
 * Fetches price on first call, then refreshes every `intervalMs` (default 5 min).
 */
export function createBtcPriceProvider(options?: {
  initialPrice?: number;
  intervalMs?: number;
  logger?: Logger;
}): {
  getPrice: () => number | undefined;
  stop: () => void;
} {
  const intervalMs = options?.intervalMs ?? 5 * 60 * 1000;
  let currentPrice = options?.initialPrice;
  let timer: ReturnType<typeof setInterval> | null = null;

  const refresh = async () => {
    const price = await fetchBtcPrice(options?.logger);
    if (price !== null) {
      currentPrice = price;
    }
  };

  // Start refreshing
  refresh();
  timer = setInterval(refresh, intervalMs);

  return {
    getPrice: () => currentPrice,
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
