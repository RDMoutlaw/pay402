import type { Pay402ClientConfig } from "../types/config.js";
import { Pay402Error } from "../types/errors.js";

/**
 * Validate wallet configs eagerly at construction time.
 * Catches obvious misconfigurations before a 402 is ever encountered.
 */
export function validateConfig(config: Pay402ClientConfig): void {
  if (!config.wallets || config.wallets.length === 0) {
    throw new Pay402Error("At least one wallet must be configured");
  }

  for (const wallet of config.wallets) {
    switch (wallet.type) {
      case "lightning":
        if (!wallet.lndHost) {
          throw new Pay402Error("Lightning wallet: lndHost is required");
        }
        if (!wallet.lndMacaroon) {
          throw new Pay402Error("Lightning wallet: lndMacaroon is required");
        }
        if (!/^[0-9a-fA-F]+$/.test(wallet.lndMacaroon)) {
          throw new Pay402Error(
            "Lightning wallet: lndMacaroon must be hex-encoded",
          );
        }
        break;

      case "evm":
        if (!wallet.privateKey) {
          throw new Pay402Error("EVM wallet: privateKey is required");
        }
        if (!wallet.privateKey.startsWith("0x")) {
          throw new Pay402Error(
            "EVM wallet: privateKey must start with 0x",
          );
        }
        if (!/^0x[0-9a-fA-F]{64}$/.test(wallet.privateKey)) {
          throw new Pay402Error(
            "EVM wallet: privateKey must be a 32-byte hex string (0x + 64 hex chars)",
          );
        }
        break;

      case "solana":
        if (!wallet.secretKey) {
          throw new Pay402Error("Solana wallet: secretKey is required");
        }
        break;

      default:
        throw new Pay402Error(
          `Unknown wallet type: ${(wallet as { type: string }).type}`,
        );
    }
  }

  if (
    config.btcPriceUsd !== undefined &&
    (config.btcPriceUsd <= 0 || !Number.isFinite(config.btcPriceUsd))
  ) {
    throw new Pay402Error("btcPriceUsd must be a positive finite number");
  }

  if (
    config.maxSinglePaymentUsd !== undefined &&
    (config.maxSinglePaymentUsd <= 0 ||
      !Number.isFinite(config.maxSinglePaymentUsd))
  ) {
    throw new Pay402Error(
      "maxSinglePaymentUsd must be a positive finite number",
    );
  }

  // Warn if Lightning wallet exists but no btcPriceUsd
  const hasLightning = config.wallets.some((w) => w.type === "lightning");
  if (hasLightning && config.btcPriceUsd === undefined) {
    // Not an error, but cost estimates will be $0
  }
}
