export interface LightningWalletConfig {
  type: "lightning";
  /** LND REST API host, e.g. "https://localhost:8080" */
  lndHost: string;
  /** Hex-encoded admin macaroon */
  lndMacaroon: string;
  /** Base64-encoded TLS cert for self-signed LND nodes */
  tlsCert?: string;
}

export interface EVMWalletConfig {
  type: "evm";
  /** Hex private key with 0x prefix */
  privateKey: `0x${string}`;
  chain: "base" | "base-sepolia";
  /** RPC URL, defaults to public Base RPC */
  rpcUrl?: string;
  /** x402 facilitator URL, defaults to "https://x402.org/facilitate" */
  facilitatorUrl?: string;
}

export interface SolanaWalletConfig {
  type: "solana";
  /** Base58-encoded keypair or raw Uint8Array */
  secretKey: string | Uint8Array;
  cluster: "mainnet-beta" | "devnet";
  /** x402 facilitator URL */
  facilitatorUrl?: string;
}

export interface ArkadeWalletConfig {
  type: "arkade";
  /** BIP-39 mnemonic */
  mnemonic: string;
  /** Arkade server URL, e.g. "https://arkade.computer" */
  arkServerUrl: string;
  network: "mainnet" | "testnet";
}

export type WalletConfig =
  | LightningWalletConfig
  | EVMWalletConfig
  | SolanaWalletConfig
  | ArkadeWalletConfig;
