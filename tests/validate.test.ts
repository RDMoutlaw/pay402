import { describe, it, expect } from "vitest";
import { validateConfig } from "../src/client/validate.js";
import { Pay402Error } from "../src/types/errors.js";

describe("validateConfig", () => {
  const validLightning = {
    type: "lightning" as const,
    lndHost: "https://localhost:8080",
    lndMacaroon: "deadbeef0123456789abcdef",
  };

  const validEvm = {
    type: "evm" as const,
    privateKey:
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const,
    chain: "base" as const,
  };

  it("accepts valid config with lightning wallet", () => {
    expect(() =>
      validateConfig({ wallets: [validLightning] }),
    ).not.toThrow();
  });

  it("accepts valid config with evm wallet", () => {
    expect(() => validateConfig({ wallets: [validEvm] })).not.toThrow();
  });

  it("accepts valid config with multiple wallets", () => {
    expect(() =>
      validateConfig({ wallets: [validLightning, validEvm] }),
    ).not.toThrow();
  });

  it("rejects empty wallets array", () => {
    expect(() => validateConfig({ wallets: [] })).toThrow(
      /at least one wallet/i,
    );
  });

  it("rejects lightning wallet with non-hex macaroon", () => {
    expect(() =>
      validateConfig({
        wallets: [{ ...validLightning, lndMacaroon: "not-hex!" }],
      }),
    ).toThrow(/hex-encoded/);
  });

  it("rejects lightning wallet without lndHost", () => {
    expect(() =>
      validateConfig({
        wallets: [{ ...validLightning, lndHost: "" }],
      }),
    ).toThrow(/lndHost/);
  });

  it("rejects evm wallet without 0x prefix", () => {
    expect(() =>
      validateConfig({
        wallets: [
          {
            type: "evm" as const,
            privateKey:
              "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as `0x${string}`,
            chain: "base" as const,
          },
        ],
      }),
    ).toThrow(/0x/);
  });

  it("rejects evm wallet with wrong-length key", () => {
    expect(() =>
      validateConfig({
        wallets: [
          {
            type: "evm" as const,
            privateKey: "0xshort" as `0x${string}`,
            chain: "base" as const,
          },
        ],
      }),
    ).toThrow(/32-byte/);
  });

  it("rejects negative btcPriceUsd", () => {
    expect(() =>
      validateConfig({ wallets: [validLightning], btcPriceUsd: -100 }),
    ).toThrow(/btcPriceUsd/);
  });

  it("rejects zero btcPriceUsd", () => {
    expect(() =>
      validateConfig({ wallets: [validLightning], btcPriceUsd: 0 }),
    ).toThrow(/btcPriceUsd/);
  });

  it("rejects Infinity btcPriceUsd", () => {
    expect(() =>
      validateConfig({
        wallets: [validLightning],
        btcPriceUsd: Infinity,
      }),
    ).toThrow(/btcPriceUsd/);
  });

  it("rejects negative maxSinglePaymentUsd", () => {
    expect(() =>
      validateConfig({
        wallets: [validLightning],
        maxSinglePaymentUsd: -1,
      }),
    ).toThrow(/maxSinglePaymentUsd/);
  });

  it("accepts valid btcPriceUsd", () => {
    expect(() =>
      validateConfig({
        wallets: [validLightning],
        btcPriceUsd: 60000,
      }),
    ).not.toThrow();
  });
});
