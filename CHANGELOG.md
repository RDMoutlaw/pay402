# Changelog

## 0.2.0

### Features

- **USDC→Lightning bridge** — New `LendasatBridgeProvider` enables EVM (USDC) wallets to pay L402 (Lightning) endpoints via LendaSat gasless atomic swaps with Permit2 signing
- **Arkade payment rail** — Added Arkade wallet type with VTXO support
- **Arkade→Lightning bridge** — Cross-rail bridge via Boltz submarine swap (`@arkade-os/boltz-swap`)
- **MCP agent tools** — `pay402_fetch`, `pay402_estimate`, `pay402_spending`, `pay402_balance` for AI agent autonomous payment
- **MCP payment wrapper** — `mcpPaymentWrapper` for gating MCP tools behind payment challenges
- **Server-side Arkade support** — Express and MCP middleware accept Arkade as a payment rail
- **SKILL.md** — Agent skill discovery file for MCP tool registration
- **Spending summary API** — `client.getSpendingSummary()` with period filtering (hour/day/all) and per-rail breakdown
- **Balance API** — `client.getBalances()` for checking wallet balances

### Fixes

- **Token cache bug** — Fixed `tokenType→railId` key mapping for correct multi-rail caching

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
