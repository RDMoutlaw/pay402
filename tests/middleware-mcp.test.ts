import { describe, it, expect, vi } from "vitest";
import {
  mcpPaymentWrapper,
  type McpPaymentChallenge,
} from "../src/middleware/mcp.js";

// Minimal mock of McpServer — just needs registerTool
function createMockServer() {
  const registeredTools = new Map<
    string,
    {
      config: Record<string, unknown>;
      handler: (args: Record<string, unknown>, extra: unknown) => unknown;
    }
  >();

  const server = {
    registerTool: vi.fn(
      (
        name: string,
        config: Record<string, unknown>,
        handler: (args: Record<string, unknown>, extra: unknown) => unknown,
      ) => {
        registeredTools.set(name, { config, handler });
        return { name, enabled: true };
      },
    ),
    _registered: registeredTools,
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

    // Get the wrapped handler
    const tool = server._registered.get("premium-tool")!;

    // Call without payment proof
    const result = (await tool.handler({}, {})) as {
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

  it("passes through to real handler with valid L402 proof", async () => {
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
      { description: "A paid tool" },
      async (args: Record<string, unknown>) => ({
        content: [{ type: "text" as const, text: `result: ${args.query}` }],
      }),
    );

    const tool = server._registered.get("premium-tool")!;

    const result = (await tool.handler(
      {
        query: "hello",
        _payment_proof: {
          type: "l402",
          macaroon: "good-mac",
          preimage: "good-pre",
        },
      },
      {},
    )) as { content: Array<{ type: string; text: string }> };

    expect(result.content[0].text).toBe("result: hello");
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
    const tool = server._registered.get("tool")!;

    await tool.handler(
      {
        data: "value",
        _payment_proof: { type: "l402", macaroon: "m", preimage: "p" },
      },
      {},
    );

    expect(handlerSpy).toHaveBeenCalledWith(
      { data: "value" },
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

    const tool = server._registered.get("tool")!;
    const result = (await tool.handler(
      {
        _payment_proof: { type: "l402", macaroon: "bad", preimage: "bad" },
      },
      {},
    )) as { content: Array<{ text: string }>; isError?: boolean };

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
    const tool = server._registered.get("free-tool")!;

    const result = (await tool.handler({}, {})) as {
      content: Array<{ text: string }>;
    };
    expect(result.content[0].text).toBe("free");
    // Handler should be called directly without payment wrapping
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

    const tool = server._registered.get("tool")!;

    // Valid x402 proof
    const result = (await tool.handler(
      {
        _payment_proof: {
          type: "x402",
          payload: { signature: "0xvalid" },
        },
      },
      {},
    )) as { content: Array<{ text: string }>; isError?: boolean };

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

    const tool = server._registered.get("tool")!;
    const result = (await tool.handler({}, {})) as {
      content: Array<{ text: string }>;
    };

    const challenge: McpPaymentChallenge = JSON.parse(
      result.content[0].text,
    );
    expect(challenge.challenges).toHaveLength(1);
    expect(challenge.challenges[0].rail).toBe("l402");
  });
});
