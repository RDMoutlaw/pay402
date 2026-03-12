import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the rails and bridge so the client can be constructed
vi.mock("../src/rails/lightning.js", () => ({
  LightningRailAdapter: class {
    railId = "l402" as const;
    canHandle() { return false; }
    async pay() { return {} as never; }
    buildAuthHeader() { return {}; }
    async estimateCost() { return { amountRaw: "0", currency: "sats", amountUsd: 0, confidence: "estimate" }; }
  },
}));

vi.mock("../src/rails/x402-base.js", () => ({
  X402BaseAdapter: class {
    railId = "x402-base" as const;
    canHandle() { return false; }
    async pay() { return {} as never; }
    buildAuthHeader() { return {}; }
    async estimateCost() { return { amountRaw: "0", currency: "USDC", amountUsd: 0, confidence: "exact" }; }
  },
}));

vi.mock("../src/rails/x402-solana.js", () => ({
  X402SolanaAdapter: class {
    railId = "x402-solana" as const;
    canHandle() { return false; }
    async pay() { return {} as never; }
    buildAuthHeader() { return {}; }
    async estimateCost() { return { amountRaw: "0", currency: "USDC", amountUsd: 0, confidence: "exact" }; }
  },
}));

vi.mock("../src/rails/arkade.js", () => ({
  getOrCreateArkadeWallet: vi.fn(),
}));

vi.mock("../src/bridge/arkade-bridge.js", () => ({
  ArkadeBridgeProvider: class {
    canBridge() { return false; }
    async quote() { return {} as never; }
    async execute() { return {} as never; }
  },
}));

import { registerPay402Tools } from "../src/mcp-tool/index.js";
import { Pay402Client } from "../src/client/pay402-client.js";

// Minimal mock of McpServer
function createMockServer() {
  const registeredTools = new Map<
    string,
    {
      config: Record<string, unknown>;
      handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;
    }
  >();

  return {
    _registered: registeredTools,
    registerTool: vi.fn(
      (
        name: string,
        config: Record<string, unknown>,
        handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown>,
      ) => {
        registeredTools.set(name, { config, handler });
        return { update: vi.fn(), remove: vi.fn(), disable: vi.fn(), enable: vi.fn() };
      },
    ),
  };
}

describe("registerPay402Tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let client: Pay402Client;

  beforeEach(() => {
    server = createMockServer();
    client = new Pay402Client({
      wallets: [
        {
          type: "lightning",
          lndHost: "https://localhost:8080",
          lndMacaroon: "deadbeef",
        },
      ],
    });
  });

  it("registers 4 tools", () => {
    registerPay402Tools(server as any, { client });

    expect(server.registerTool).toHaveBeenCalledTimes(4);
    expect(server._registered.has("pay402_fetch")).toBe(true);
    expect(server._registered.has("pay402_estimate")).toBe(true);
    expect(server._registered.has("pay402_spending")).toBe(true);
    expect(server._registered.has("pay402_balance")).toBe(true);
  });

  it("pay402_spending returns summary", async () => {
    registerPay402Tools(server as any, { client });

    const tool = server._registered.get("pay402_spending")!;
    const result = (await tool.handler({}, {})) as {
      content: Array<{ text: string }>;
    };

    const summary = JSON.parse(result.content[0].text);
    expect(summary.totalUsd).toBe(0);
    expect(summary.count).toBe(0);
    expect(summary.byRail).toEqual({});
  });

  it("pay402_balance returns wallet info", async () => {
    registerPay402Tools(server as any, { client });

    const tool = server._registered.get("pay402_balance")!;
    const result = (await tool.handler({}, {})) as {
      content: Array<{ text: string }>;
    };

    const data = JSON.parse(result.content[0].text);
    expect(data.wallets).toHaveLength(1);
    expect(data.wallets[0].type).toBe("lightning");
    expect(data.wallets[0].error).toBe("balance check not supported");
  });

  it("pay402_fetch handles errors gracefully", async () => {
    // Override fetch to throw
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    registerPay402Tools(server as any, { client });

    const tool = server._registered.get("pay402_fetch")!;
    const result = (await tool.handler(
      { url: "https://api.example.com/fail" },
      {},
    )) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text);
    expect(body.error).toContain("Network error");

    globalThis.fetch = originalFetch;
  });
});
