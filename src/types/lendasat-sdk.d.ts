declare module "@lendasat/lendaswap-sdk-pure" {
  export class InMemoryWalletStorage {}
  export class InMemorySwapStorage {}

  export class Client {
    static builder(): ClientBuilder;
    createEvmToLightningSwapGeneric(params: {
      lightningInvoice: string;
      evmChainId: number;
      tokenAddress: string;
      userAddress: string;
      gasless?: boolean;
    }): Promise<{
      id: string;
      source_amount: string;
      fee_sats: number;
      status: string;
    }>;
    fundSwapGasless(swapId: string): Promise<void>;
    getSwap(swapId: string): Promise<{
      id: string;
      status: string;
      lightning_paid: boolean;
      preimage?: string;
      source_amount: string;
      fee_sats: number;
    }>;
  }

  export interface ClientBuilder {
    withSignerStorage(storage: InMemoryWalletStorage): ClientBuilder;
    withSwapStorage(storage: InMemorySwapStorage): ClientBuilder;
    build(): Promise<Client>;
  }
}
