import type { Pay402ClientConfig } from "../types/config.js";
import type { WalletConfig } from "../types/wallet.js";
import { Pay402Client } from "./pay402-client.js";

/**
 * Create a Pay402Client from environment variables.
 * Detects which wallets are configured based on which env vars are set.
 *
 * Lightning: LND_HOST + LND_MACAROON
 * EVM:       EVM_PRIVATE_KEY (+ optional EVM_CHAIN, EVM_FACILITATOR_URL)
 * Solana:    SOLANA_SECRET_KEY (+ optional SOLANA_CLUSTER, SOLANA_FACILITATOR_URL)
 *
 * Spend controls: PAY402_MAX_PER_REQUEST, PAY402_MAX_HOURLY, PAY402_MAX_DAILY
 * BTC price:      PAY402_BTC_PRICE_USD or PAY402_AUTO_BTC_PRICE=true
 * Logging:        PAY402_LOG_LEVEL
 */
export function fromEnv(
  overrides?: Partial<Pay402ClientConfig>,
): Pay402Client {
  const wallets: WalletConfig[] = [];

  // Lightning
  const lndHost = process.env.LND_HOST;
  const lndMacaroon = process.env.LND_MACAROON;
  if (lndHost && lndMacaroon) {
    wallets.push({
      type: "lightning",
      lndHost,
      lndMacaroon,
      tlsCert: process.env.LND_TLS_CERT,
    });
  }

  // EVM
  const evmKey = process.env.EVM_PRIVATE_KEY;
  if (evmKey) {
    wallets.push({
      type: "evm",
      privateKey: evmKey as `0x${string}`,
      chain: (process.env.EVM_CHAIN as "base" | "base-sepolia") ?? "base",
      facilitatorUrl: process.env.EVM_FACILITATOR_URL,
    });
  }

  // Solana
  const solKey = process.env.SOLANA_SECRET_KEY;
  if (solKey) {
    wallets.push({
      type: "solana",
      secretKey: solKey,
      cluster:
        (process.env.SOLANA_CLUSTER as "mainnet-beta" | "devnet") ??
        "mainnet-beta",
      facilitatorUrl: process.env.SOLANA_FACILITATOR_URL,
    });
  }

  // Arkade
  const arkadeMnemonic = process.env.ARKADE_MNEMONIC;
  const arkadeServerUrl = process.env.ARKADE_SERVER_URL;
  if (arkadeMnemonic && arkadeServerUrl) {
    wallets.push({
      type: "arkade",
      mnemonic: arkadeMnemonic,
      arkServerUrl: arkadeServerUrl,
      network:
        (process.env.ARKADE_NETWORK as "mainnet" | "testnet") ?? "mainnet",
    });
  }

  const maxPerRequest = parseFloat(
    process.env.PAY402_MAX_PER_REQUEST ?? "",
  );
  const maxHourly = parseFloat(process.env.PAY402_MAX_HOURLY ?? "");
  const maxDaily = parseFloat(process.env.PAY402_MAX_DAILY ?? "");
  const btcPrice = parseFloat(process.env.PAY402_BTC_PRICE_USD ?? "");
  const autoBtc = process.env.PAY402_AUTO_BTC_PRICE === "true";

  const config: Pay402ClientConfig = {
    wallets,
    spendControls: {
      global: {
        ...(Number.isFinite(maxPerRequest) && {
          maxPerRequest,
        }),
        ...(Number.isFinite(maxHourly) && { maxHourly }),
        ...(Number.isFinite(maxDaily) && { maxDaily }),
      },
    },
    ...(Number.isFinite(btcPrice) && { btcPriceUsd: btcPrice }),
    autoFetchBtcPrice: autoBtc,
    logLevel: process.env.PAY402_LOG_LEVEL ?? "info",
    ...overrides,
  };

  // Merge wallets from overrides if provided
  if (overrides?.wallets) {
    config.wallets = [...wallets, ...overrides.wallets];
  }

  return new Pay402Client(config);
}
