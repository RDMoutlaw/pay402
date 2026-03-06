import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import type { RailAdapter } from "../types/adapter.js";
import type { PaymentChallenge, X402Challenge } from "../types/challenge.js";
import type {
  CostEstimate,
  PaymentProof,
  X402PaymentProof,
} from "../types/payment.js";
import type { WalletConfig, SolanaWalletConfig } from "../types/wallet.js";
import { PaymentFailedError } from "../types/errors.js";
import bs58 from "bs58";

export class X402SolanaAdapter implements RailAdapter {
  readonly railId = "x402-solana" as const;

  canHandle(challenge: PaymentChallenge): boolean {
    return (
      challenge.type === "x402" &&
      (challenge.network === "solana" || challenge.network === "solana-devnet")
    );
  }

  async pay(
    challenge: PaymentChallenge,
    wallet: WalletConfig,
  ): Promise<PaymentProof> {
    if (challenge.type !== "x402") {
      throw new PaymentFailedError(
        "x402-solana",
        new Error("Not an x402 challenge"),
      );
    }
    if (wallet.type !== "solana") {
      throw new PaymentFailedError(
        "x402-solana",
        new Error("Not a Solana wallet"),
      );
    }

    // If facilitator URL is set, delegate to it (same pattern as x402-base)
    if (wallet.facilitatorUrl) {
      return this.payViaFacilitator(challenge, wallet);
    }

    // Direct on-chain payment
    return this.payOnChain(challenge, wallet);
  }

  buildAuthHeader(proof: PaymentProof): Record<string, string> {
    if (proof.type !== "x402") {
      throw new Error("Not an x402 proof");
    }
    const encoded = btoa(JSON.stringify(proof.payload));
    return { "X-PAYMENT": encoded };
  }

  async estimateCost(challenge: PaymentChallenge): Promise<CostEstimate> {
    if (challenge.type !== "x402") {
      throw new Error("Not an x402 challenge");
    }
    // USDC on Solana also has 6 decimals
    const amountUsd =
      parseInt(challenge.maxAmountRequired, 10) / 1_000_000;

    return {
      amountRaw: challenge.maxAmountRequired,
      currency: "USDC",
      amountUsd,
      confidence: "exact",
    };
  }

  private async payViaFacilitator(
    challenge: X402Challenge,
    wallet: SolanaWalletConfig,
  ): Promise<PaymentProof> {
    const keypair = this.getKeypair(wallet);
    const from = keypair.publicKey.toBase58();

    const payload: X402PaymentProof["payload"] = {
      signature: "", // will be set by facilitator
      from,
      to: challenge.payTo,
      value: challenge.maxAmountRequired,
      validAfter: "0",
      validBefore: String(
        Math.floor(Date.now() / 1000) + challenge.maxTimeoutSeconds,
      ),
      nonce: Math.random().toString(36).slice(2),
    };

    try {
      const response = await fetch(wallet.facilitatorUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload,
          network: challenge.network,
          asset: challenge.asset,
          resource: challenge.resource,
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "unknown error");
        throw new PaymentFailedError(
          "x402-solana",
          new Error(`Facilitator returned ${response.status}: ${text}`),
        );
      }

      const result = (await response.json()) as { signature?: string };
      payload.signature = result.signature ?? "";
    } catch (err) {
      if (err instanceof PaymentFailedError) throw err;
      throw new PaymentFailedError(
        "x402-solana",
        new Error(`Facilitator request failed: ${(err as Error).message}`),
      );
    }

    return { type: "x402", payload };
  }

  private async payOnChain(
    challenge: X402Challenge,
    wallet: SolanaWalletConfig,
  ): Promise<PaymentProof> {
    const keypair = this.getKeypair(wallet);
    const cluster =
      challenge.network === "solana" ? "mainnet-beta" : "devnet";
    const connection = new Connection(clusterApiUrl(cluster), "confirmed");

    const mint = new PublicKey(challenge.asset);
    const recipient = new PublicKey(challenge.payTo);
    const amount = BigInt(challenge.maxAmountRequired);

    let senderAta: PublicKey;
    let recipientAta: PublicKey;
    try {
      senderAta = await getAssociatedTokenAddress(
        mint,
        keypair.publicKey,
      );
      recipientAta = await getAssociatedTokenAddress(mint, recipient);
    } catch (err) {
      throw new PaymentFailedError(
        "x402-solana",
        new Error(
          `Failed to derive token accounts: ${(err as Error).message}`,
        ),
      );
    }

    const tx = new Transaction().add(
      createTransferInstruction(
        senderAta,
        recipientAta,
        keypair.publicKey,
        amount,
      ),
    );

    let signature: string;
    try {
      signature = await connection.sendTransaction(tx, [keypair]);
      await connection.confirmTransaction(signature, "confirmed");
    } catch (err) {
      throw new PaymentFailedError(
        "x402-solana",
        new Error(
          `Solana transaction failed: ${(err as Error).message}`,
        ),
      );
    }

    return {
      type: "x402",
      payload: {
        signature,
        from: keypair.publicKey.toBase58(),
        to: challenge.payTo,
        value: challenge.maxAmountRequired,
        validAfter: "0",
        validBefore: String(
          Math.floor(Date.now() / 1000) + challenge.maxTimeoutSeconds,
        ),
        nonce: signature, // use tx signature as nonce for on-chain
      },
    };
  }

  private getKeypair(wallet: SolanaWalletConfig): Keypair {
    if (wallet.secretKey instanceof Uint8Array) {
      return Keypair.fromSecretKey(wallet.secretKey);
    }
    // base58-encoded
    return Keypair.fromSecretKey(bs58.decode(wallet.secretKey));
  }
}
