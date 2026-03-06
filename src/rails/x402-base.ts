import { ethers } from "ethers";
import type { RailAdapter } from "../types/adapter.js";
import type { PaymentChallenge, X402Challenge } from "../types/challenge.js";
import type {
  CostEstimate,
  PaymentProof,
  X402PaymentProof,
} from "../types/payment.js";
import type { WalletConfig, EVMWalletConfig } from "../types/wallet.js";
import { PaymentFailedError } from "../types/errors.js";

const DEFAULT_FACILITATOR_URL = "https://x402.org/facilitate";

// EIP-3009 TransferWithAuthorization typed data
const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

export class X402BaseAdapter implements RailAdapter {
  readonly railId = "x402-base" as const;

  canHandle(challenge: PaymentChallenge): boolean {
    return (
      challenge.type === "x402" &&
      (challenge.network === "base" || challenge.network === "base-sepolia")
    );
  }

  async pay(
    challenge: PaymentChallenge,
    wallet: WalletConfig,
  ): Promise<PaymentProof> {
    if (challenge.type !== "x402") {
      throw new PaymentFailedError(
        "x402-base",
        new Error("Not an x402 challenge"),
      );
    }
    if (wallet.type !== "evm") {
      throw new PaymentFailedError(
        "x402-base",
        new Error("Not an EVM wallet"),
      );
    }

    const signer = new ethers.Wallet(wallet.privateKey);
    const from = await signer.getAddress();
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    const validAfter = "0";
    const validBefore = String(
      Math.floor(Date.now() / 1000) + challenge.maxTimeoutSeconds,
    );

    // Build EIP-712 domain from challenge extra or defaults
    const chainId = challenge.network === "base" ? 8453 : 84532;
    const tokenName = (challenge.extra?.name as string) ?? "USD Coin";
    const tokenVersion = (challenge.extra?.version as string) ?? "2";

    const domain: ethers.TypedDataDomain = {
      name: tokenName,
      version: tokenVersion,
      chainId,
      verifyingContract: challenge.asset,
    };

    const message = {
      from,
      to: challenge.payTo,
      value: challenge.maxAmountRequired,
      validAfter,
      validBefore,
      nonce,
    };

    let signature: string;
    try {
      signature = await signer.signTypedData(domain, EIP3009_TYPES, message);
    } catch (err) {
      throw new PaymentFailedError(
        "x402-base",
        new Error(`EIP-712 signing failed: ${(err as Error).message}`),
      );
    }

    const payload: X402PaymentProof["payload"] = {
      signature,
      from,
      to: challenge.payTo,
      value: challenge.maxAmountRequired,
      validAfter,
      validBefore,
      nonce,
    };

    // Submit to facilitator
    const facilitatorUrl =
      wallet.facilitatorUrl ?? challenge.facilitatorUrl ?? DEFAULT_FACILITATOR_URL;

    try {
      const response = await fetch(facilitatorUrl, {
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
          "x402-base",
          new Error(`Facilitator returned ${response.status}: ${text}`),
        );
      }
    } catch (err) {
      if (err instanceof PaymentFailedError) throw err;
      throw new PaymentFailedError(
        "x402-base",
        new Error(`Facilitator request failed: ${(err as Error).message}`),
      );
    }

    return { type: "x402", payload };
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
    // USDC has 6 decimals, 1:1 with USD
    const amountUsd =
      parseInt(challenge.maxAmountRequired, 10) / 1_000_000;

    return {
      amountRaw: challenge.maxAmountRequired,
      currency: "USDC",
      amountUsd,
      confidence: "exact",
    };
  }
}
