import { describe, it, expect, vi, afterEach } from "vitest";
import { SpendControls } from "../src/controls/spend-controls.js";
import { SpendLimitExceededError, Pay402Error } from "../src/types/errors.js";

describe("SpendControls", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("denylist", () => {
    it("blocks URLs matching denylist patterns", () => {
      const controls = new SpendControls({
        denylist: ["https://*.evil.com/**"],
      });
      expect(() => controls.check("https://api.evil.com/data", 0.5)).toThrow(
        Pay402Error,
      );
      expect(() => controls.check("https://api.evil.com/data", 0.5)).toThrow(
        /denylist/,
      );
    });

    it("allows URLs not matching denylist", () => {
      const controls = new SpendControls({
        denylist: ["https://*.evil.com/**"],
      });
      expect(() =>
        controls.check("https://api.good.com/data", 0.5),
      ).not.toThrow();
    });
  });

  describe("allowlist", () => {
    it("blocks URLs not in allowlist when allowlist is set", () => {
      const controls = new SpendControls({
        allowlist: ["https://api.trusted.com/**"],
      });
      expect(() =>
        controls.check("https://api.untrusted.com/data", 0.5),
      ).toThrow(/allowlist/);
    });

    it("allows URLs matching allowlist", () => {
      const controls = new SpendControls({
        allowlist: ["https://api.trusted.com/**"],
      });
      expect(() =>
        controls.check("https://api.trusted.com/data", 0.5),
      ).not.toThrow();
    });
  });

  describe("global per-request limit", () => {
    it("throws when amount exceeds per-request max", () => {
      const controls = new SpendControls({
        global: { maxPerRequest: 1.0 },
      });
      expect(() =>
        controls.check("https://api.example.com", 1.5),
      ).toThrow(SpendLimitExceededError);
    });

    it("allows amounts within per-request max", () => {
      const controls = new SpendControls({
        global: { maxPerRequest: 1.0 },
      });
      expect(() =>
        controls.check("https://api.example.com", 0.5),
      ).not.toThrow();
    });
  });

  describe("global daily limit", () => {
    it("throws when cumulative spend would exceed daily limit", () => {
      vi.useFakeTimers();
      const controls = new SpendControls({
        global: { maxDaily: 5.0 },
      });

      // Record $4.50 in prior payments
      controls.recordPayment({
        timestamp: Date.now(),
        amountUsd: 4.5,
        endpoint: "https://api.example.com",
        rail: "l402",
      });

      // Attempt $1.00 more — should exceed $5.00 daily
      expect(() =>
        controls.check("https://api.example.com", 1.0),
      ).toThrow(SpendLimitExceededError);

      try {
        controls.check("https://api.example.com", 1.0);
      } catch (e) {
        const err = e as SpendLimitExceededError;
        expect(err.limitType).toBe("global daily");
        expect(err.limitAmountUsd).toBe(5.0);
        expect(err.attemptedAmountUsd).toBe(1.0);
        expect(err.currentSpendUsd).toBe(4.5);
      }
    });

    it("allows spend within daily limit", () => {
      const controls = new SpendControls({
        global: { maxDaily: 5.0 },
      });

      controls.recordPayment({
        timestamp: Date.now(),
        amountUsd: 3.0,
        endpoint: "https://api.example.com",
        rail: "l402",
      });

      expect(() =>
        controls.check("https://api.example.com", 1.5),
      ).not.toThrow();
    });

    it("resets after 24 hour window rolls over", () => {
      vi.useFakeTimers();
      const controls = new SpendControls({
        global: { maxDaily: 5.0 },
      });

      controls.recordPayment({
        timestamp: Date.now(),
        amountUsd: 4.5,
        endpoint: "https://api.example.com",
        rail: "l402",
      });

      // Advance 25 hours — old payment should be outside window
      vi.advanceTimersByTime(25 * 60 * 60 * 1000);

      expect(() =>
        controls.check("https://api.example.com", 4.5),
      ).not.toThrow();
    });
  });

  describe("global hourly limit", () => {
    it("throws when hourly spend would be exceeded", () => {
      vi.useFakeTimers();
      const controls = new SpendControls({
        global: { maxHourly: 2.0 },
      });

      controls.recordPayment({
        timestamp: Date.now(),
        amountUsd: 1.5,
        endpoint: "https://api.example.com",
        rail: "x402-base",
      });

      expect(() =>
        controls.check("https://api.example.com", 1.0),
      ).toThrow(SpendLimitExceededError);
    });
  });

  describe("per-endpoint limits", () => {
    it("enforces per-endpoint per-request limit", () => {
      const controls = new SpendControls({
        perEndpoint: {
          "https://api.example.com/**": { maxPerRequest: 0.5 },
        },
      });

      expect(() =>
        controls.check("https://api.example.com/expensive", 1.0),
      ).toThrow(SpendLimitExceededError);
    });

    it("enforces per-endpoint daily limit", () => {
      vi.useFakeTimers();
      const controls = new SpendControls({
        perEndpoint: {
          "https://api.example.com/**": { maxDaily: 3.0 },
        },
      });

      controls.recordPayment({
        timestamp: Date.now(),
        amountUsd: 2.5,
        endpoint: "https://api.example.com/data",
        rail: "l402",
      });

      expect(() =>
        controls.check("https://api.example.com/data", 1.0),
      ).toThrow(SpendLimitExceededError);
    });
  });

  describe("wouldExceed", () => {
    it("returns null when within limits", () => {
      const controls = new SpendControls({
        global: { maxDaily: 10.0 },
      });
      expect(controls.wouldExceed("https://api.example.com", 1.0)).toBeNull();
    });

    it("returns limit type when would exceed", () => {
      const controls = new SpendControls({
        global: { maxPerRequest: 1.0 },
      });
      expect(
        controls.wouldExceed("https://api.example.com", 5.0),
      ).toBe("global per-request");
    });
  });

  describe("check order", () => {
    it("denylist is checked before allowlist", () => {
      const controls = new SpendControls({
        denylist: ["https://*.evil.com/**"],
        allowlist: ["https://*.evil.com/**"],
      });
      // Even though it's in the allowlist, denylist takes priority
      expect(() =>
        controls.check("https://api.evil.com/data", 0.5),
      ).toThrow(/denylist/);
    });

    it("spend checks only run if URL passes list checks", () => {
      const controls = new SpendControls({
        denylist: ["https://*.evil.com/**"],
        global: { maxPerRequest: 100 },
      });
      // Should throw denylist error, not spend error
      expect(() =>
        controls.check("https://api.evil.com/data", 0.01),
      ).toThrow(/denylist/);
    });
  });

  describe("railPreference", () => {
    it("returns default order when not configured", () => {
      const controls = new SpendControls({});
      expect(controls.railPreference).toEqual([
        "l402",
        "x402-base",
        "x402-solana",
        "arkade",
      ]);
    });

    it("returns configured preference", () => {
      const controls = new SpendControls({
        railPreference: ["x402-base", "l402"],
      });
      expect(controls.railPreference).toEqual(["x402-base", "l402"]);
    });

    it("returns 'cheapest' when configured", () => {
      const controls = new SpendControls({
        railPreference: "cheapest",
      });
      expect(controls.railPreference).toBe("cheapest");
    });
  });
});
