# Changelog

## 0.1.0

Initial release.

### Features

- **Pay402Client** — drop-in `fetch()` replacement that automatically handles HTTP 402 responses
- **pay402Fetch** — one-liner convenience factory
- **Lightning (L402)** — LND REST API adapter with BOLT11 parsing, invoice expiry validation, IN_FLIGHT handling
- **x402 Base** — EVM adapter with EIP-3009 TransferWithAuthorization signing via ethers v6
- **x402 Solana** — SPL token transfer adapter with facilitator and direct on-chain modes
- **Spend controls** — per-request, hourly, and daily limits (global and per-endpoint), allowlist/denylist via picomatch globs, dry-run mode
- **Token cache** — in-memory cache keyed by method+URL with TTL-based expiry
- **Rail selection** — ordered preference or cheapest-first mode across all configured rails
- **Express middleware** — `pay402Middleware` for gating routes behind 402 with multi-rail challenge headers
- **MCP wrapper** — `mcpPaymentWrapper` for gating MCP tools with structured payment-required errors
- **Structured logging** — pino-based JSON logging configurable via `logLevel` or `PAY402_LOG_LEVEL` env var
- **Live BTC price** — auto-fetching provider with configurable refresh interval
- **Config validation** — eager validation of wallet configs at construction time
- **Concurrent deduplication** — parallel requests to the same endpoint share a single payment
- **Safety** — $10 hard ceiling default, no auto-retry after payment failure, no auto-fallback between rails after payment
