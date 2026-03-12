import type { RailAdapter } from "../types/adapter.js";
import type { PaymentChallenge, ArkadeChallenge } from "../types/challenge.js";
import type { CostEstimate, PaymentProof } from "../types/payment.js";
import type { WalletConfig, ArkadeWalletConfig } from "../types/wallet.js";
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

export class ArkadeRailAdapter implements RailAdapter {
  readonly railId = "arkade" as const;

  canHandle(challenge: PaymentChallenge): boolean {
    return challenge.type === "arkade";
  }

  async pay(
    challenge: PaymentChallenge,
    wallet: WalletConfig,
  ): Promise<PaymentProof> {
    if (challenge.type !== "arkade") {
      throw new PaymentFailedError(
        "arkade",
        new Error("Not an Arkade challenge"),
      );
    }
    if (wallet.type !== "arkade") {
      throw new PaymentFailedError(
        "arkade",
        new Error("Not an Arkade wallet"),
      );
    }

    const arkWallet = await getOrCreateArkadeWallet(wallet);
    const from = await arkWallet.getAddress();

    try {
      const result = await arkWallet.sendBitcoin({
        address: (challenge as ArkadeChallenge).payTo,
        amount: (challenge as ArkadeChallenge).amountSats,
      });

      return {
        type: "arkade",
        txId: result.txId,
        from,
      };
    } catch (err) {
      throw new PaymentFailedError("arkade", err as Error);
    }
  }

  buildAuthHeader(proof: PaymentProof): Record<string, string> {
    if (proof.type !== "arkade") {
      throw new Error("Not an Arkade proof");
    }
    return {
      "X-Arkade-Payment-Proof": btoa(
        JSON.stringify({ txId: proof.txId, from: proof.from }),
      ),
    };
  }

  async estimateCost(
    challenge: PaymentChallenge,
    btcPriceUsd?: number,
  ): Promise<CostEstimate> {
    if (challenge.type !== "arkade") {
      throw new Error("Not an Arkade challenge");
    }

    const amountSats = challenge.amountSats;
    const amountUsd = btcPriceUsd ? (amountSats / 1e8) * btcPriceUsd : 0;

    return {
      amountRaw: String(amountSats),
      currency: "sats",
      amountUsd,
      confidence: "exact", // no routing fees — deterministic cost
    };
  }
}
