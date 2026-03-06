import { describe, it, expect, vi } from "vitest";
import { pay402Middleware } from "../src/middleware/express.js";
import {
  mcpPaymentWrapper,
  type McpPaymentChallenge,
} from "../src/middleware/mcp.js";
import type { Request, Response } from "express";

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    path: "/api/data",
    originalUrl: "/api/data",
    protocol: "https",
    headers: {},
    get: (name: string) => (name === "host" ? "api.example.com" : ""),
    ...overrides,
  } as unknown as Request;
}

function mockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    _headers: {} as Record<string, string>,
  };
  res.setHeader.mockImplementation((name: string, value: string) => {
    res._headers[name.toLowerCase()] = value;
    return res;
  });
  return res as unknown as Response & {
    _headers: Record<string, string>;
  };
}

describe("pay402Middleware — edge cases", () => {
  it("falls through to 402 when verifyL402 is not provided", async () => {
    const mw = pay402Middleware({
      pricing: { "/api/data": { l402: 1000 } },
      acceptedRails: ["l402"],
      // No verifyL402 provided
    });

    const req = mockReq({
      headers: { authorization: "L402 mac:pre" },
    });
    const res = mockRes();
    const next = vi.fn();

    await mw(req, res, next);

    // Should return 402 since there's no way to verify the proof
    expect(res.status).toHaveBeenCalledWith(402);
    expect(next).not.toHaveBeenCalled();
  });

  it("falls through to 402 when verifyX402 is not provided", async () => {
    const mw = pay402Middleware({
      pricing: { "/api/data": { x402: 1000000 } },
      acceptedRails: ["x402"],
      x402PayTo: "0xAddr",
      x402Asset: "0xToken",
      // No verifyX402 provided
    });

    const payload = btoa(JSON.stringify({ signature: "0xsig" }));
    const req = mockReq({
      headers: { "x-payment": payload },
    });
    const res = mockRes();
    const next = vi.fn();

    await mw(req, res, next);

    expect(res.status).toHaveBeenCalledWith(402);
    expect(next).not.toHaveBeenCalled();
  });

  it("only advertises L402 when only L402 pricing is set", async () => {
    const mw = pay402Middleware({
      pricing: { "/api/data": { l402: 1000 } },
      acceptedRails: ["l402", "x402"],
    });

    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await mw(req, res, next);

    expect(res.status).toHaveBeenCalledWith(402);
    expect(res._headers["www-authenticate"]).toBeTruthy();
    // No x402 header since pricing doesn't include x402
    expect(res._headers["x-payment-required"]).toBeUndefined();
  });

  it("handles async verify functions", async () => {
    const mw = pay402Middleware({
      pricing: { "/api/data": { l402: 1000 } },
      acceptedRails: ["l402"],
      verifyL402: async (mac, pre) => {
        // Simulate async verification (e.g., database lookup)
        await new Promise((r) => setTimeout(r, 10));
        return mac === "valid" && pre === "valid";
      },
    });

    const req = mockReq({
      headers: { authorization: "L402 valid:valid" },
    });
    const res = mockRes();
    const next = vi.fn();

    await mw(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe("mcpPaymentWrapper — edge cases", () => {
  function createMockServer() {
    const registeredTools = new Map<
      string,
      {
        config: Record<string, unknown>;
        handler: (
          args: Record<string, unknown>,
          extra: unknown,
        ) => unknown;
      }
    >();

    return {
      registerTool: vi.fn(
        (
          name: string,
          config: Record<string, unknown>,
          handler: (
            args: Record<string, unknown>,
            extra: unknown,
          ) => unknown,
        ) => {
          registeredTools.set(name, { config, handler });
          return { name, enabled: true };
        },
      ),
      _registered: registeredTools,
    };
  }

  it("rejects proof with unknown type", async () => {
    const server = createMockServer();

    mcpPaymentWrapper({
      server: server as any,
      pricing: { "tool": { l402: 100 } },
      acceptedRails: ["l402"],
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
    const result = (await tool.handler(
      {
        _payment_proof: { type: "unknown-rail" },
      },
      {},
    )) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toBe("payment_invalid");
  });

  it("rejects L402 proof with missing macaroon", async () => {
    const server = createMockServer();

    mcpPaymentWrapper({
      server: server as any,
      pricing: { "tool": { l402: 100 } },
      acceptedRails: ["l402"],
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
    const result = (await tool.handler(
      {
        _payment_proof: { type: "l402", preimage: "pre" },
        // macaroon missing
      },
      {},
    )) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
  });

  it("rejects x402 proof with missing payload", async () => {
    const server = createMockServer();

    mcpPaymentWrapper({
      server: server as any,
      pricing: { "tool": { x402: 100000 } },
      acceptedRails: ["x402"],
      verifyX402: () => true,
    });

    server.registerTool(
      "tool",
      {},
      async () => ({
        content: [{ type: "text" as const, text: "data" }],
      }),
    );

    const tool = server._registered.get("tool")!;
    const result = (await tool.handler(
      {
        _payment_proof: { type: "x402" },
        // payload missing
      },
      {},
    )) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
  });

  it("rejects L402 proof when verifyL402 callback is not provided", async () => {
    const server = createMockServer();

    mcpPaymentWrapper({
      server: server as any,
      pricing: { "tool": { l402: 100 } },
      acceptedRails: ["l402"],
      // No verifyL402 provided
    });

    server.registerTool(
      "tool",
      {},
      async () => ({
        content: [{ type: "text" as const, text: "data" }],
      }),
    );

    const tool = server._registered.get("tool")!;
    const result = (await tool.handler(
      {
        _payment_proof: {
          type: "l402",
          macaroon: "mac",
          preimage: "pre",
        },
      },
      {},
    )) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toBe("payment_invalid");
  });
});
