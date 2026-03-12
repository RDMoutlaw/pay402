import type { ArkadeWalletConfig } from "../types/wallet.js";
import { PaymentFailedError } from "../types/errors.js";

// Module-level wallet instance cache keyed by "arkServerUrl::mnemonic_prefix"
const walletCache = new Map<string, unknown>();

function cacheKey(config: ArkadeWalletConfig): string {
  const prefix = config.mnemonic.split(" ").slice(0, 3).join(" ");
  return `${config.arkServerUrl}::${prefix}`;
}

/**
 * Get or create an Arkade wallet instance. Shared between the rail adapter
 * and the bridge provider to avoid duplicate wallet instantiation.
 */
export async function getOrCreateArkadeWallet(
  config: ArkadeWalletConfig,
): Promise<InstanceType<typeof import("@arkade-os/sdk").Wallet>> {
  const key = cacheKey(config);
  const cached = walletCache.get(key);
  if (cached) {
    return cached as InstanceType<typeof import("@arkade-os/sdk").Wallet>;
  }

  let sdk: typeof import("@arkade-os/sdk");
  try {
    sdk = await import("@arkade-os/sdk");
  } catch {
    throw new PaymentFailedError(
      "arkade",
      new Error(
        "Missing @arkade-os/sdk — install it with: npm install @arkade-os/sdk",
      ),
    );
  }

  const identity = new sdk.MnemonicIdentity(config.mnemonic);
  const wallet = new sdk.Wallet({
    identity,
    arkServerUrl: config.arkServerUrl,
    network: config.network,
  });

  walletCache.set(key, wallet);
  return wallet;
}

