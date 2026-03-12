declare module "@arkade-os/sdk" {
  export class MnemonicIdentity {
    constructor(mnemonic: string);
  }

  export interface SendBitcoinParams {
    address: string;
    amount: number;
  }

  export interface SendBitcoinResult {
    txId: string;
  }

  export interface WalletBalance {
    total: number;
    confirmed: number;
    unconfirmed: number;
  }

  export class Wallet {
    constructor(options: {
      identity: MnemonicIdentity;
      arkServerUrl: string;
      network: "mainnet" | "testnet";
    });
    sendBitcoin(params: SendBitcoinParams): Promise<SendBitcoinResult>;
    getBalance(): Promise<WalletBalance>;
    getAddress(): Promise<string>;
  }
}

declare module "@arkade-os/boltz-swap" {
  export interface SwapFees {
    minerFees: number;
    percentage: number;
    totalEstimate: number;
  }

  export interface SendLightningResult {
    preimage: string;
  }

  export class ArkadeSwaps {
    constructor(wallet: import("@arkade-os/sdk").Wallet);
    getFees(): Promise<SwapFees>;
    sendLightningPayment(invoice: string): Promise<SendLightningResult>;
  }
}
