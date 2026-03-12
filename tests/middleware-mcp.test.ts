import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import {
  mcpPaymentWrapper,
  type McpPaymentChallenge,
} from "../src/middleware/mcp.js";

// Mock server that simulates Zod validation like the real MCP SDK.
// The real SDK parses args through the tool's inputSchema before
// calling the handler — unknown fields get stripped.
function createMockServer() {
  const registeredTools = new Map<
    string,
    {
      config: Record<string, unknown>;
      handler: (args: Record<string, unknown>, extra: unknown) => unknown;
      inputSchema?: unknown;
    }
  >();

  const server = {
    registerTool: vi.fn(
      (
        name: string,
        config: Record<string, unknown>,
        handler: (args: Record<string, unknown>, extra: unknown) => unknown,
      ) => {
        registeredTools.set(name, {
          config,
          handler,
          inputSchema: config.inputSchema,
        });
        return { name, enabled: true, update: vi.fn(), remove: vi.fn(), disable: vi.fn(), enable: vi.fn() };
      },
    ),
    _registered: registeredTools,

    /**
     * Simulate how the real MCP SDK calls a tool:
     * parse args through the inputSchema, then call the handler.
     */
    async callTool(name: string, rawArgs: Record<string, unknown>) {
      const tool = registeredTools.get(name);
      if (!tool) throw new Error(`Tool ${name} not found`);

      let parsedArgs = rawArgs;

      // Simulate Zod validation + stripping like the real SDK
      if (tool.inputSchema) {
        let schema: z.ZodTypeAny;

        // Handle both ZodRawShapeCompat (plain object) and ZodObject
        if (
          typeof tool.inputSchema === "object" &&
          tool.inputSchema !== null &&
          "_def" in (tool.inputSchema as any)
        ) {
          // Already a Zod schema
          schema = tool.inputSchema as z.ZodTypeAny;
        } else {
          // ZodRawShapeCompat — wrap in z.object()
          schema = z.object(tool.inputSchema as Record<string, z.ZodTypeAny>);
        }

        const result = schema.safeParse(rawArgs);
        if (!result.success) {
          throw new Error(`Validation failed: ${result.error.message}`);
        }
        parsedArgs = result.data;
      }

      return tool.handler(parsedArgs, {});
    },
  };

  return server;
}

describe("mcpPaymentWrapper", () => {
  it("wraps priced tools and returns payment challenge when no proof", async () => {
    const server = createMockServer();

    mcpPaymentWrapper({
      server: server as any,
      pricing: {
        "premium-tool": { l402: 500, x402: 250000 },
      },
      acceptedRails: ["l402", "x402"],
      verifyL402: () => true,
      x402Network: "base",
      x402PayTo: "0xAddr",
      x402Asset: "0xToken",
    });

    // Register a tool after wrapping
    server.registerTool(
      "premium-tool",
      { description: "A paid tool" },
      async (args: Record<string, unknown>) => ({
        content: [{ type: "text" as const, text: "secret data" }],
      }),
    );

    // Call without payment proof via SDK-like path
    const result = (await server.callTool("premium-tool", {})) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    const challenge: McpPaymentChallenge = JSON.parse(
      result.content[0].text,
    );
    expect(challenge.error).toBe("payment_required");
    expect(challenge.version).toBe("pay402/1.0");
    expect(challenge.challenges).toHaveLength(2);
    expect(challenge.challenges[0]).toEqual({
      rail: "l402",
      amountSats: 500,
    });
  });

  it("passes L402 proof through Zod validation to the handler", async () => {
    const server = createMockServer();

    mcpPaymentWrapper({
      server: server as any,
      pricing: {
        "premium-tool": { l402: 500 },
      },
      acceptedRails: ["l402"],
      verifyL402: (mac, pre) => mac === "good-mac" && pre === "good-pre",
    });

    server.registerTool(
      "premium-tool",
      {
        description: "A paid tool",
        inputSchema: { query: z.string() },
      },
      async (args: Record<string, unknown>) => ({
        content: [{ type: "text" as const, text: `result: ${args.query}` }],
      }),
    );

    // Call with payment proof — the proof must survive Zod validation
    const result = (await server.callTool("premium-tool", {
      query: "hello",
      _payment_proof: {
        type: "l402",
        macaroon: "good-mac",
        preimage: "good-pre",
      },
    })) as { content: Array<{ type: string; text: string }> };

    expect(result.content[0].text).toBe("result: hello");
  });

  it("injects _payment_proof into schema so it survives validation", async () => {
    const server = createMockServer();

    mcpPaymentWrapper({
      server: server as any,
      pricing: { "tool": { l402: 100 } },
      acceptedRails: ["l402"],
      verifyL402: () => true,
    });

    server.registerTool(
      "tool",
      { inputSchema: { name: z.string() } },
      async (args: Record<string, unknown>) => ({
        content: [{ type: "text" as const, text: "ok" }],
      }),
    );

    // Verify the registered tool's schema includes _payment_proof
    const tool = server._registered.get("tool")!;
    const schema = tool.inputSchema as Record<string, z.ZodTypeAny>;
    expect(schema["_payment_proof"]).toBeDefined();
    expect(schema["name"]).toBeDefined();
  });

  it("strips _payment_proof from args before passing to handler", async () => {
    const server = createMockServer();
    const handlerSpy = vi.fn(async (args: Record<string, unknown>) => ({
      content: [{ type: "text" as const, text: "ok" }],
    }));

    mcpPaymentWrapper({
      server: server as any,
      pricing: { "tool": { l402: 100 } },
      acceptedRails: ["l402"],
      verifyL402: () => true,
    });

    server.registerTool("tool", {}, handlerSpy);

    await server.callTool("tool", {
      data: "value",
      _payment_proof: { type: "l402", macaroon: "m", preimage: "p" },
    });

    expect(handlerSpy).toHaveBeenCalledWith(
      expect.not.objectContaining({ _payment_proof: expect.anything() }),
      {},
    );
  });

  it("rejects invalid payment proof", async () => {
    const server = createMockServer();

    mcpPaymentWrapper({
      server: server as any,
      pricing: { "tool": { l402: 100 } },
      acceptedRails: ["l402"],
      verifyL402: () => false, // Always reject
    });

    server.registerTool(
      "tool",
      {},
      async () => ({
        content: [{ type: "text" as const, text: "secret" }],
      }),
    );

    const result = (await server.callTool("tool", {
      _payment_proof: { type: "l402", macaroon: "bad", preimage: "bad" },
    })) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toBe("payment_invalid");
  });

  it("does not wrap tools without pricing", async () => {
    const server = createMockServer();
    const handler = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "free" }],
    }));

    mcpPaymentWrapper({
      server: server as any,
      pricing: { "paid-tool": { l402: 100 } },
      acceptedRails: ["l402"],
      verifyL402: () => true,
    });

    server.registerTool("free-tool", {}, handler);

    const result = (await server.callTool("free-tool", {})) as {
      content: Array<{ text: string }>;
    };
    expect(result.content[0].text).toBe("free");
    expect(handler).toHaveBeenCalled();
  });

  it("supports x402 proof verification", async () => {
    const server = createMockServer();

    mcpPaymentWrapper({
      server: server as any,
      pricing: { "tool": { x402: 1000000 } },
      acceptedRails: ["x402"],
      verifyX402: (payload) => payload.signature === "0xvalid",
    });

    server.registerTool(
      "tool",
      {},
      async () => ({
        content: [{ type: "text" as const, text: "paid content" }],
      }),
    );

    const result = (await server.callTool("tool", {
      _payment_proof: {
        type: "x402",
        payload: { signature: "0xvalid" },
      },
    })) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe("paid content");
  });

  it("only advertises configured rails in challenge", async () => {
    const server = createMockServer();

    mcpPaymentWrapper({
      server: server as any,
      pricing: { "tool": { l402: 100, x402: 500000 } },
      acceptedRails: ["l402"], // Only L402 accepted
      verifyL402: () => true,
    });

    server.registerTool(
      "tool",
      {},
      async () => ({
        content: [{ type: "text" as const, text: "data" }],
      }),
    );

    const result = (await server.callTool("tool", {})) as {
      content: Array<{ text: string }>;
    };

    const challenge: McpPaymentChallenge = JSON.parse(
      result.content[0].text,
    );
    expect(challenge.challenges).toHaveLength(1);
    expect(challenge.challenges[0].rail).toBe("l402");
  });

});
