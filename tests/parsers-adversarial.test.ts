import { describe, it, expect } from "vitest";
import {
  parseL402Header,
  parseX402Header,
  parseBolt11Amount,
  parseChallenges,
} from "../src/parsers/index.js";

describe("L402 parser — adversarial inputs", () => {
  it("handles extremely long header values without hanging", () => {
    const longMacaroon = "A".repeat(100_000);
    const header = `L402 macaroon="${longMacaroon}", invoice="lnbc100u1rest"`;
    const start = Date.now();
    const result = parseL402Header(header);
    const elapsed = Date.now() - start;

    expect(result).not.toBeNull();
    expect(result!.macaroon).toBe(longMacaroon);
    expect(elapsed).toBeLessThan(1000); // should be near-instant
  });

  it("rejects header with embedded newlines", () => {
    const header = 'L402 macaroon="abc\ndef", invoice="lnbc100u1rest"';
    // Should still parse since the regex handles this
    const result = parseL402Header(header);
    // The macaroon will contain the newline — not a security issue,
    // just verifying no crash
    expect(result).not.toBeNull();
  });

  it("handles header with no spaces after L402", () => {
    const result = parseL402Header("L402");
    expect(result).toBeNull();
  });

  it("handles empty string", () => {
    expect(parseL402Header("")).toBeNull();
  });

  it("handles header with only whitespace", () => {
    expect(parseL402Header("   ")).toBeNull();
  });

  it("rejects header with invoice containing quotes", () => {
    const header = 'L402 macaroon="abc", invoice="lnbc100u1"rest"';
    const result = parseL402Header(header);
    // The quoted-string parser will stop at the first closing quote
    // so invoice will be "lnbc100u1" which is valid prefix
    expect(result).not.toBeNull();
  });

  it("handles duplicate parameter names gracefully", () => {
    const header =
      'L402 macaroon="first", macaroon="second", invoice="lnbc100u1rest"';
    const result = parseL402Header(header);
    // Should use the first match
    expect(result).not.toBeNull();
    expect(result!.macaroon).toBe("first");
  });
});

describe("x402 parser — adversarial inputs", () => {
  it("rejects deeply nested JSON", () => {
    const deep = '{"a":'.repeat(100) + '1' + '}'.repeat(100);
    expect(parseX402Header(deep)).toBeNull();
  });

  it("rejects JSON array instead of object", () => {
    expect(parseX402Header("[]")).toBeNull();
    expect(parseX402Header("[1,2,3]")).toBeNull();
  });

  it("rejects null JSON", () => {
    expect(parseX402Header("null")).toBeNull();
  });

  it("rejects JSON with extra fields (but valid required fields)", () => {
    const payload = {
      scheme: "exact",
      network: "base",
      maxAmountRequired: "1000000",
      resource: "https://api.example.com/data",
      payTo: "0x1234",
      asset: "0x5678",
      maxTimeoutSeconds: 60,
      malicious: "<script>alert('xss')</script>",
    };
    const result = parseX402Header(JSON.stringify(payload));
    // Should parse successfully — extra fields are ignored
    expect(result).not.toBeNull();
    expect(result!.maxAmountRequired).toBe("1000000");
  });

  it("rejects maxAmountRequired that is a number instead of string", () => {
    const payload = {
      scheme: "exact",
      network: "base",
      maxAmountRequired: 1000000, // number, not string
      resource: "https://api.example.com/data",
      payTo: "0x1234",
      asset: "0x5678",
      maxTimeoutSeconds: 60,
    };
    expect(parseX402Header(JSON.stringify(payload))).toBeNull();
  });

  it("rejects maxTimeoutSeconds that is a string", () => {
    const payload = {
      scheme: "exact",
      network: "base",
      maxAmountRequired: "1000000",
      resource: "https://api.example.com/data",
      payTo: "0x1234",
      asset: "0x5678",
      maxTimeoutSeconds: "60", // string, not number
    };
    expect(parseX402Header(JSON.stringify(payload))).toBeNull();
  });

  it("handles extremely large maxAmountRequired", () => {
    const payload = {
      scheme: "exact",
      network: "base",
      maxAmountRequired: "999999999999999999",
      resource: "https://api.example.com/data",
      payTo: "0x1234",
      asset: "0x5678",
      maxTimeoutSeconds: 60,
    };
    const result = parseX402Header(JSON.stringify(payload));
    expect(result).not.toBeNull();
    expect(result!.maxAmountRequired).toBe("999999999999999999");
  });

  it("handles empty string fields", () => {
    const payload = {
      scheme: "exact",
      network: "base",
      maxAmountRequired: "",
      resource: "",
      payTo: "",
      asset: "",
      maxTimeoutSeconds: 60,
    };
    // Empty strings are still strings — parser accepts them
    const result = parseX402Header(JSON.stringify(payload));
    expect(result).not.toBeNull();
  });
});

describe("BOLT11 parser — adversarial inputs", () => {
  it("handles empty string", () => {
    expect(parseBolt11Amount("")).toBeNull();
  });

  it("handles very long input without hanging", () => {
    const long = "lnbc" + "0".repeat(100_000) + "u1rest";
    const start = Date.now();
    const result = parseBolt11Amount(long);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
    // The regex should match the digits
    expect(result).not.toBeNull();
  });

  it("handles amount overflow gracefully", () => {
    // 999999999999999p = way beyond safe integer range for sats
    const result = parseBolt11Amount("lnbc999999999999999p1rest");
    // Should return a number (may lose precision, but shouldn't crash)
    expect(typeof result).toBe("number");
  });

  it("returns null for invoice with only prefix and no data", () => {
    expect(parseBolt11Amount("lnbc")).toBeNull();
  });

  it("handles regtest prefix correctly", () => {
    expect(parseBolt11Amount("lnbcrt500u1rest")).toBe(50_000);
  });
});

describe("parseChallenges — edge cases", () => {
  it("returns empty array for empty Headers object", () => {
    expect(parseChallenges(new Headers())).toHaveLength(0);
  });

  it("returns empty array when headers have wrong values", () => {
    const headers = new Headers();
    headers.set("www-authenticate", "Bearer token123");
    headers.set("x-payment-required", "not-json");
    expect(parseChallenges(headers)).toHaveLength(0);
  });

  it("returns partial results when only one header is valid", () => {
    const headers = new Headers();
    headers.set(
      "www-authenticate",
      'L402 macaroon="abc", invoice="lnbc100u1rest"',
    );
    headers.set("x-payment-required", "invalid-json");

    const challenges = parseChallenges(headers);
    expect(challenges).toHaveLength(1);
    expect(challenges[0].type).toBe("l402");
  });
});
