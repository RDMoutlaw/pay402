import { describe, it, expect, vi } from "vitest";
import { pay402Middleware } from "../src/middleware/express.js";
import type { Request, Response, NextFunction } from "express";

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

describe("pay402Middleware", () => {
  const middleware = pay402Middleware({
    pricing: {
      "/api/data": { l402: 1000, x402: 500000 },
      "/api/premium/*": { x402: 2000000 },
    },
    acceptedRails: ["l402", "x402"],
    verifyL402: (macaroon, preimage) =>
      macaroon === "valid-mac" && preimage === "valid-pre",
    verifyX402: (payload) => payload.signature === "valid-sig",
    x402Network: "base",
    x402PayTo: "0xRecipient",
    x402Asset: "0xUSDC",
  });

  it("passes through routes without pricing", async () => {
    const req = mockReq({ path: "/free/endpoint" });
    const res = mockRes();
    const next = vi.fn();

    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("returns 402 with both challenge headers when no payment proof", async () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(402);
    expect(next).not.toHaveBeenCalled();

    // Should have both L402 and x402 headers
    expect(res._headers["www-authenticate"]).toMatch(/^L402 /);
    expect(res._headers["x-payment-required"]).toBeTruthy();

    // Parse x402 challenge
    const x402 = JSON.parse(res._headers["x-payment-required"]);
    expect(x402.scheme).toBe("exact");
    expect(x402.network).toBe("base");
    expect(x402.maxAmountRequired).toBe("500000");
    expect(x402.payTo).toBe("0xRecipient");
  });

  it("accepts valid L402 payment proof and calls next()", async () => {
    const req = mockReq({
      headers: { authorization: "L402 valid-mac:valid-pre" },
    });
    const res = mockRes();
    const next = vi.fn();

    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects invalid L402 proof with 401", async () => {
    const req = mockReq({
      headers: { authorization: "L402 bad-mac:bad-pre" },
    });
    const res = mockRes();
    const next = vi.fn();

    await middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts valid x402 payment proof and calls next()", async () => {
    const payload = btoa(JSON.stringify({ signature: "valid-sig" }));
    const req = mockReq({
      headers: { "x-payment": payload },
    });
    const res = mockRes();
    const next = vi.fn();

    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("rejects invalid x402 proof with 401", async () => {
    const payload = btoa(JSON.stringify({ signature: "bad-sig" }));
    const req = mockReq({
      headers: { "x-payment": payload },
    });
    const res = mockRes();
    const next = vi.fn();

    await middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects malformed x402 base64 with 401", async () => {
    const req = mockReq({
      headers: { "x-payment": "not-valid-base64!!!" },
    });
    const res = mockRes();
    const next = vi.fn();

    await middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("matches wildcard route patterns", async () => {
    const req = mockReq({ path: "/api/premium/feature" });
    const res = mockRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(402);
    // Should only have x402 since premium route only has x402 pricing
    expect(res._headers["x-payment-required"]).toBeTruthy();
    const x402 = JSON.parse(res._headers["x-payment-required"]);
    expect(x402.maxAmountRequired).toBe("2000000");
  });

  it("fires onPaymentReceived callback on successful L402 verification", async () => {
    const onPaymentReceived = vi.fn();
    const mw = pay402Middleware({
      pricing: { "/api/data": { l402: 1000 } },
      acceptedRails: ["l402"],
      verifyL402: () => true,
      onPaymentReceived,
    });

    const req = mockReq({
      headers: { authorization: "L402 mac:pre" },
    });
    const res = mockRes();
    const next = vi.fn();

    await mw(req, res, next);
    expect(onPaymentReceived).toHaveBeenCalledWith({
      rail: "l402",
      route: "/api/data",
      amount: 1000,
    });
  });

  it("only advertises configured rails", async () => {
    const mw = pay402Middleware({
      pricing: { "/api/data": { x402: 1000000 } },
      acceptedRails: ["x402"],
      x402PayTo: "0xAddr",
      x402Asset: "0xToken",
    });

    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await mw(req, res, next);

    expect(res.status).toHaveBeenCalledWith(402);
    expect(res._headers["x-payment-required"]).toBeTruthy();
    // No L402 header since it's not in acceptedRails and no l402 pricing
    expect(res._headers["www-authenticate"]).toBeUndefined();
  });
});
