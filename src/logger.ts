import pino from "pino";

export type Logger = pino.Logger;

const defaultLogger = pino({
  name: "pay402",
  level: process.env.PAY402_LOG_LEVEL ?? "info",
});

export function createLogger(level?: string): Logger {
  if (level) {
    return pino({ name: "pay402", level });
  }
  return defaultLogger;
}
