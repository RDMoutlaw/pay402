import { describe, it, expect } from "vitest";
import {
  parseL402Header,
  parseX402Header,
  parseBolt11Amount,
  parseChallenges,
} from "../src/parsers/index.js";

describe("parseBolt11Amount", () => {
  it("parses milli-BTC amounts", () => {
    // lnbc1m = 0.001 BTC = 100,000 sats
    expect(parseBolt11Amount("lnbc1m1rest")).toBe(100_000);
  });

  it("parses micro-BTC amounts", () => {
    // lnbc100u = 0.0001 BTC = 10,000 sats
    expect(parseBolt11Amount("lnbc100u1rest")).toBe(10_000);
  });

  it("parses nano-BTC amounts", () => {
    // lnbc1000n = 0.000001 BTC = 100 sats
    expect(parseBolt11Amount("lnbc1000n1rest")).toBe(100);
  });

  it("parses pico-BTC amounts", () => {
    // lnbc10000p = 0.00000001 BTC = 1 sat
    expect(parseBolt11Amount("lnbc10000p1rest")).toBe(1);
  });

  it("returns null for zero-amount invoices", () => {
    expect(parseBolt11Amount("lnbc1rest")).toBeNull();
  });

  it("handles testnet invoices", () => {
    expect(parseBolt11Amount("lntb500u1rest")).toBe(50_000);
  });

  it("handles regtest invoices", () => {
    expect(parseBolt11Amount("lnbcrt200u1rest")).toBe(20_000);
  });

  it("returns null for garbage input", () => {
    expect(parseBolt11Amount("notaninvoice")).toBeNull();
  });
});

describe("parseL402Header", () => {
  it("parses a standard L402 header with quoted values", () => {
    const header =
      'L402 macaroon="AgELZXhhbXBsZS5jb20", invoice="lnbc100u1rest"';
    const result = parseL402Header(header);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("l402");
    expect(result!.macaroon).toBe("AgELZXhhbXBsZS5jb20");
    expect(result!.invoice).toBe("lnbc100u1rest");
    expect(result!.amountSats).toBe(10_000);
    expect(result!.rawHeader).toBe(header);
  });

  it("parses LSAT prefix (backwards compat)", () => {
    const header =
      'LSAT macaroon="AgELZXhhbXBsZS5jb20", invoice="lnbc100u1rest"';
    const result = parseL402Header(header);
    expect(result).not.toBeNull();
    expect(result!.macaroon).toBe("AgELZXhhbXBsZS5jb20");
  });

  it("handles unquoted values", () => {
    const header =
      "L402 macaroon=AgELZXhhbXBsZS5jb20, invoice=lnbc100u1rest";
    const result = parseL402Header(header);
    expect(result).not.toBeNull();
    expect(result!.macaroon).toBe("AgELZXhhbXBsZS5jb20");
    expect(result!.invoice).toBe("lnbc100u1rest");
  });

  it("returns null for non-L402 headers", () => {
    expect(parseL402Header("Bearer token123")).toBeNull();
    expect(parseL402Header("Basic dXNlcjpwYXNz")).toBeNull();
  });

  it("returns null when macaroon is missing", () => {
    expect(parseL402Header('L402 invoice="lnbc100u1rest"')).toBeNull();
  });

  it("returns null when invoice is missing", () => {
    expect(
      parseL402Header('L402 macaroon="AgELZXhhbXBsZS5jb20"'),
    ).toBeNull();
  });

  it("returns null for invalid invoice prefix", () => {
    expect(
      parseL402Header('L402 macaroon="abc", invoice="invalid123"'),
    ).toBeNull();
  });

  it("handles extra whitespace", () => {
    const header =
      'L402   macaroon = "AgELZXhhbXBsZS5jb20" ,  invoice = "lnbc100u1rest"';
    const result = parseL402Header(header);
    expect(result).not.toBeNull();
  });
});

describe("parseX402Header", () => {
  const validPayload = {
    scheme: "exact",
    network: "base",
    maxAmountRequired: "1000000",
    resource: "https://api.example.com/data",
    payTo: "0x1234567890abcdef1234567890abcdef12345678",
    asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    maxTimeoutSeconds: 60,
  };

  it("parses a valid x402 JSON payload", () => {
    const result = parseX402Header(JSON.stringify(validPayload));

    expect(result).not.toBeNull();
    expect(result!.type).toBe("x402");
    expect(result!.scheme).toBe("exact");
    expect(result!.network).toBe("base");
    expect(result!.maxAmountRequired).toBe("1000000");
    expect(result!.payTo).toBe(
      "0x1234567890abcdef1234567890abcdef12345678",
    );
    expect(result!.maxTimeoutSeconds).toBe(60);
  });

  it("includes extra field when present", () => {
    const payload = {
      ...validPayload,
      extra: { name: "USD Coin", version: "2" },
    };
    const result = parseX402Header(JSON.stringify(payload));
    expect(result!.extra).toEqual({ name: "USD Coin", version: "2" });
  });

  it("accepts all valid networks", () => {
    for (const network of ["base", "base-sepolia", "solana", "solana-devnet"]) {
      const result = parseX402Header(
        JSON.stringify({ ...validPayload, network }),
      );
      expect(result).not.toBeNull();
      expect(result!.network).toBe(network);
    }
  });

  it("rejects invalid network", () => {
    expect(
      parseX402Header(
        JSON.stringify({ ...validPayload, network: "ethereum" }),
      ),
    ).toBeNull();
  });

  it("rejects invalid scheme", () => {
    expect(
      parseX402Header(
        JSON.stringify({ ...validPayload, scheme: "subscription" }),
      ),
    ).toBeNull();
  });

  it("rejects non-JSON", () => {
    expect(parseX402Header("not json")).toBeNull();
  });

  it("rejects missing required fields", () => {
    const { payTo, ...incomplete } = validPayload;
    expect(parseX402Header(JSON.stringify(incomplete))).toBeNull();
  });

  it("rejects zero or negative timeout", () => {
    expect(
      parseX402Header(
        JSON.stringify({ ...validPayload, maxTimeoutSeconds: 0 }),
      ),
    ).toBeNull();
    expect(
      parseX402Header(
        JSON.stringify({ ...validPayload, maxTimeoutSeconds: -1 }),
      ),
    ).toBeNull();
  });

  it("normalizes CAIP-2 network identifiers", () => {
    const caip2Map: Record<string, string> = {
      "eip155:8453": "base",
      "eip155:84532": "base-sepolia",
    };
    for (const [caip2, expected] of Object.entries(caip2Map)) {
      const result = parseX402Header(
        JSON.stringify({ ...validPayload, network: caip2 }),
      );
      expect(result).not.toBeNull();
      expect(result!.network).toBe(expected);
    }
  });

  it("parses base64-encoded JSON payload", () => {
    const encoded = btoa(JSON.stringify(validPayload));
    const result = parseX402Header(encoded);
    expect(result).not.toBeNull();
    expect(result!.network).toBe("base");
    expect(result!.maxAmountRequired).toBe("1000000");
  });

  it("parses x402 v2 format with accepts array", () => {
    const v2Payload = {
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: "1000000",
          resource: "https://api.example.com/data",
          payTo: "0x1234567890abcdef1234567890abcdef12345678",
          asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          maxTimeoutSeconds: 60,
        },
      ],
    };
    const result = parseX402Header(JSON.stringify(v2Payload));
    expect(result).not.toBeNull();
    expect(result!.network).toBe("base");
    expect(result!.maxAmountRequired).toBe("1000000");
    expect(result!.payTo).toBe(
      "0x1234567890abcdef1234567890abcdef12345678",
    );
  });

  it("parses base64-encoded v2 format", () => {
    const v2Payload = {
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: "500000",
          resource: "https://api.example.com/data",
          payTo: "0xabcdef",
          asset: "0x123456",
          maxTimeoutSeconds: 30,
        },
      ],
    };
    const encoded = btoa(JSON.stringify(v2Payload));
    const result = parseX402Header(encoded);
    expect(result).not.toBeNull();
    expect(result!.network).toBe("base");
    expect(result!.maxAmountRequired).toBe("500000");
  });

  it("inherits resource from top-level in v2 format", () => {
    const v2Payload = {
      resource: "https://api.example.com/data",
      accepts: [
        {
          scheme: "exact",
          network: "base",
          amount: "1000000",
          payTo: "0x1234",
          asset: "0x5678",
        },
      ],
    };
    const result = parseX402Header(JSON.stringify(v2Payload));
    expect(result).not.toBeNull();
    expect(result!.resource).toBe("https://api.example.com/data");
  });

  it("skips unsupported networks in v2 accepts array", () => {
    const v2Payload = {
      accepts: [
        {
          scheme: "exact",
          network: "eip155:1",
          amount: "1000000",
          resource: "https://api.example.com/data",
          payTo: "0x1234",
          asset: "0x5678",
        },
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: "500000",
          resource: "https://api.example.com/data",
          payTo: "0xabcd",
          asset: "0xefgh",
        },
      ],
    };
    const result = parseX402Header(JSON.stringify(v2Payload));
    expect(result).not.toBeNull();
    expect(result!.network).toBe("base");
    expect(result!.maxAmountRequired).toBe("500000");
    expect(result!.payTo).toBe("0xabcd");
  });
});

describe("parseChallenges", () => {
  it("parses both L402 and x402 from a single response", () => {
    const headers = new Headers();
    headers.set(
      "www-authenticate",
      'L402 macaroon="abc123", invoice="lnbc100u1rest"',
    );
    headers.set(
      "x-payment-required",
      JSON.stringify({
        scheme: "exact",
        network: "base",
        maxAmountRequired: "1000000",
        resource: "https://api.example.com/data",
        payTo: "0x1234",
        asset: "0x5678",
        maxTimeoutSeconds: 60,
      }),
    );

    const challenges = parseChallenges(headers);
    expect(challenges).toHaveLength(2);
    expect(challenges[0].type).toBe("l402");
    expect(challenges[1].type).toBe("x402");
  });

  it("returns empty array when no payment headers present", () => {
    const headers = new Headers();
    headers.set("content-type", "application/json");
    expect(parseChallenges(headers)).toHaveLength(0);
  });

  it("reads x402 from payment-required header (v2 spec)", () => {
    const headers = new Headers();
    headers.set(
      "payment-required",
      JSON.stringify({
        scheme: "exact",
        network: "base",
        maxAmountRequired: "1000000",
        resource: "https://api.example.com/data",
        payTo: "0x1234",
        asset: "0x5678",
        maxTimeoutSeconds: 60,
      }),
    );
    const challenges = parseChallenges(headers);
    expect(challenges).toHaveLength(1);
    expect(challenges[0].type).toBe("x402");
  });

  it("returns only L402 when x402 is absent", () => {
    const headers = new Headers();
    headers.set(
      "www-authenticate",
      'L402 macaroon="abc", invoice="lnbc1u1rest"',
    );
    const challenges = parseChallenges(headers);
    expect(challenges).toHaveLength(1);
    expect(challenges[0].type).toBe("l402");
  });
});
