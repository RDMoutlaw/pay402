import { describe, it, expect } from "vitest";
import { createLogger } from "../src/logger.js";

describe("createLogger", () => {
  it("creates a logger with default level from env", () => {
    const log = createLogger();
    expect(log).toBeDefined();
    // In tests, PAY402_LOG_LEVEL is set to "silent" via vitest config
    expect(log.level).toBe(process.env.PAY402_LOG_LEVEL ?? "info");
  });

  it("creates a logger with custom level", () => {
    const log = createLogger("debug");
    expect(log.level).toBe("debug");
  });

  it("creates a silent logger", () => {
    const log = createLogger("silent");
    expect(log.level).toBe("silent");
  });

  it("logger has expected methods", () => {
    const log = createLogger("silent");
    expect(typeof log.info).toBe("function");
    expect(typeof log.debug).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
  });
});
