import type { Pay402ClientConfig } from "../types/config.js";
import { Pay402Client } from "./pay402-client.js";

/**
 * Convenience factory that returns a fetch-compatible function.
 *
 * Usage:
 *   const fetch402 = pay402Fetch({ wallets: [...], ... });
 *   const res = await fetch402("https://api.example.com/data");
 */
export function pay402Fetch(
  config: Pay402ClientConfig,
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  const client = new Pay402Client(config);
  return (input, init) => client.fetch(input, init);
}
