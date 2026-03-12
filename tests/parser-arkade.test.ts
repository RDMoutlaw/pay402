import { describe, it, expect } from "vitest";
import { parseArkadeHeader } from "../src/parsers/arkade.js";

describe("parseArkadeHeader", () => {
  it("parses a valid Arkade challenge header", () => {
    const header = JSON.stringify({
      payTo: "ark1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
      amountSats: 5000,
      maxTimeoutSeconds: 60,
    });

    const result = parseArkadeHeader(header);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("arkade");
    expect(result!.payTo).toBe("ark1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx");
    expect(result!.amountSats).toBe(5000);
    expect(result!.maxTimeoutSeconds).toBe(60);
    expect(result!.rawHeader).toBe(header);
  });

  it("parses without maxTimeoutSeconds", () => {
    const header = JSON.stringify({
      payTo: "ark1abc",
      amountSats: 100,
    });

    const result = parseArkadeHeader(header);
    expect(result).not.toBeNull();
    expect(result!.maxTimeoutSeconds).toBeUndefined();
  });

  it("returns null for invalid JSON", () => {
    expect(parseArkadeHeader("not json")).toBeNull();
  });

  it("returns null when payTo doesn't start with ark1", () => {
    const header = JSON.stringify({
      payTo: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      amountSats: 5000,
    });
    expect(parseArkadeHeader(header)).toBeNull();
  });

  it("returns null when payTo is not a string", () => {
    const header = JSON.stringify({
      payTo: 12345,
      amountSats: 5000,
    });
    expect(parseArkadeHeader(header)).toBeNull();
  });

  it("returns null when amountSats is zero", () => {
    const header = JSON.stringify({
      payTo: "ark1abc",
      amountSats: 0,
    });
    expect(parseArkadeHeader(header)).toBeNull();
  });

  it("returns null when amountSats is negative", () => {
    const header = JSON.stringify({
      payTo: "ark1abc",
      amountSats: -100,
    });
    expect(parseArkadeHeader(header)).toBeNull();
  });

  it("returns null when amountSats is not a number", () => {
    const header = JSON.stringify({
      payTo: "ark1abc",
      amountSats: "5000",
    });
    expect(parseArkadeHeader(header)).toBeNull();
  });

  it("returns null when amountSats is Infinity", () => {
    const header = JSON.stringify({
      payTo: "ark1abc",
      amountSats: Infinity,
    });
    // JSON.stringify converts Infinity to null
    expect(parseArkadeHeader(header)).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    expect(parseArkadeHeader('"just a string"')).toBeNull();
    expect(parseArkadeHeader("42")).toBeNull();
    expect(parseArkadeHeader("null")).toBeNull();
  });

  it("ignores invalid maxTimeoutSeconds", () => {
    const header = JSON.stringify({
      payTo: "ark1abc",
      amountSats: 100,
      maxTimeoutSeconds: -5,
    });
    const result = parseArkadeHeader(header);
    expect(result).not.toBeNull();
    expect(result!.maxTimeoutSeconds).toBeUndefined();
  });
});
