import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface McpToolPricing {
  /** Price in sats for L402 rail */
  l402?: number;
  /** Price in smallest USDC unit for x402 rail */
  x402?: number;
}

export interface McpPaymentChallenge {
  error: "payment_required";
  version: "pay402/1.0";
  challenges: Array<
    | { rail: "l402"; amountSats: number }
    | {
        rail: "x402";
        network: string;
        amountSmallestUnit: number;
        payTo: string;
        asset: string;
        maxTimeoutSeconds: number;
      }
  >;
}

export interface McpWrapperConfig {
  /** MCP Server instance to wrap */
  server: McpServer;
  /** Per-tool pricing */
  pricing: Record<string, McpToolPricing>;
  /** Verify L402 proof. Returns true if valid. */
  verifyL402?: (macaroon: string, preimage: string) => boolean | Promise<boolean>;
  /** Verify x402 proof. Returns true if valid. */
  verifyX402?: (payload: Record<string, unknown>) => boolean | Promise<boolean>;
  /** Which rails this server accepts */
  acceptedRails: Array<"l402" | "x402">;
  /** x402 payment details */
  x402Network?: string;
  x402PayTo?: string;
  x402Asset?: string;
  x402MaxTimeout?: number;
}

/** Reserved param name for payment proof in tool calls */
const PAYMENT_PROOF_PARAM = "_payment_proof";

interface PaymentProofParam {
  type: "l402" | "x402";
  macaroon?: string;
  preimage?: string;
  payload?: Record<string, unknown>;
}

/**
 * Wraps an MCP server's tool registrations to require payment.
 *
 * For tools listed in the pricing config, the wrapper intercepts tool calls:
 * - If no payment proof is in the args, returns a structured payment-required error
 * - If a proof is present, verifies it and either proceeds or rejects
 *
 * The calling client (Pay402Client or MCP transport adapter) recognizes the
 * structured error, executes payment, and retries with proof in _payment_proof.
 */
export function mcpPaymentWrapper(config: McpWrapperConfig) {
  const { server } = config;
  const originalRegisterTool = server.registerTool.bind(server);

  // Override registerTool to wrap handlers for priced tools
  server.registerTool = function wrappedRegisterTool(
    name: string,
    toolConfig: Parameters<typeof server.registerTool>[1],
    handler: Parameters<typeof server.registerTool>[2],
  ) {
    const pricing = config.pricing[name];

    if (!pricing) {
      // No pricing for this tool — register as-is
      return originalRegisterTool(name, toolConfig, handler);
    }

    // Wrap the handler with payment verification
    const wrappedHandler = async (
      args: Record<string, unknown>,
      extra: unknown,
    ): Promise<CallToolResult> => {
      const proof = args[PAYMENT_PROOF_PARAM] as
        | PaymentProofParam
        | undefined;

      // Strip the payment proof from args before passing to the real handler
      const cleanArgs = { ...args };
      delete cleanArgs[PAYMENT_PROOF_PARAM];

      if (!proof) {
        // No payment — return structured challenge
        return buildPaymentRequiredResponse(name, pricing, config);
      }

      // Verify the proof
      const verified = await verifyProof(proof, config);
      if (!verified) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "payment_invalid",
                message: "Payment proof verification failed",
              }),
            },
          ],
          isError: true,
        };
      }

      // Payment verified — call the real handler
      return (handler as Function)(cleanArgs, extra);
    };

    return originalRegisterTool(
      name,
      toolConfig,
      wrappedHandler as Parameters<typeof server.registerTool>[2],
    );
  };

  return server;
}

function buildPaymentRequiredResponse(
  toolName: string,
  pricing: McpToolPricing,
  config: McpWrapperConfig,
): CallToolResult {
  const challenges: McpPaymentChallenge["challenges"] = [];

  if (config.acceptedRails.includes("l402") && pricing.l402) {
    challenges.push({
      rail: "l402",
      amountSats: pricing.l402,
    });
  }

  if (config.acceptedRails.includes("x402") && pricing.x402) {
    challenges.push({
      rail: "x402",
      network: config.x402Network ?? "base",
      amountSmallestUnit: pricing.x402,
      payTo: config.x402PayTo ?? "",
      asset: config.x402Asset ?? "",
      maxTimeoutSeconds: config.x402MaxTimeout ?? 60,
    });
  }

  const response: McpPaymentChallenge = {
    error: "payment_required",
    version: "pay402/1.0",
    challenges,
  };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(response),
      },
    ],
    isError: true,
  };
}

async function verifyProof(
  proof: PaymentProofParam,
  config: McpWrapperConfig,
): Promise<boolean> {
  if (proof.type === "l402" && config.verifyL402) {
    if (!proof.macaroon || !proof.preimage) return false;
    return config.verifyL402(proof.macaroon, proof.preimage);
  }

  if (proof.type === "x402" && config.verifyX402) {
    if (!proof.payload) return false;
    return config.verifyX402(proof.payload);
  }

  return false;
}
