# pay402 — Universal HTTP 402 Payment Skill

pay402 enables AI agents to automatically pay for HTTP resources using multiple payment rails (Lightning, EVM/USDC, Solana/USDC, Arkade/Bitcoin VTXOs).

## Available Tools

### `pay402_fetch`
Fetch a URL with automatic HTTP 402 payment handling. If the server returns 402 Payment Required, pays using the configured wallet and retries.

**Input:**
- `url` (string, required): The URL to fetch
- `method` (string): HTTP method — GET, POST, PUT, PATCH, DELETE
- `headers` (object): Additional request headers
- `body` (string): Request body for POST/PUT/PATCH

**Output:** `{ status, headers, body, payment? }`

### `pay402_estimate`
Estimate the cost of fetching a URL without paying. Useful for confirming costs before committing.

**Input:**
- `url` (string, required): The URL to estimate
- `method` (string): HTTP method

**Output:** `{ rail, estimatedCostUsd, wouldExceedLimits, limitViolation?, challenge }`

### `pay402_spending`
View a spending summary broken down by payment rail.

**Input:**
- `period` (string): `"hour"`, `"day"`, or `"all"`

**Output:** `{ totalUsd, count, byRail }`

### `pay402_balance`
Check the balance of configured wallets.

**Input:** none

**Output:** `{ wallets: [{ type, balanceSats?, error? }] }`

## Setup

Set environment variables for the wallets you want to use:

```bash
# Lightning (L402)
LND_HOST=https://localhost:8080
LND_MACAROON=<hex-encoded admin macaroon>

# EVM / Base (x402)
EVM_PRIVATE_KEY=0x<64 hex chars>

# Solana (x402)
SOLANA_SECRET_KEY=<base58-encoded keypair>

# Arkade (Bitcoin VTXOs)
ARKADE_MNEMONIC="your twelve word mnemonic phrase here"
ARKADE_SERVER_URL=https://arkade.computer
ARKADE_NETWORK=mainnet

# Spend controls
PAY402_MAX_PER_REQUEST=1.00
PAY402_MAX_HOURLY=10.00
PAY402_MAX_DAILY=50.00
```

## Integration

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPay402Tools } from "pay402/mcp-tool";

const server = new McpServer({ name: "my-agent", version: "1.0" });
registerPay402Tools(server);
```

## Example Usage

1. Agent encounters a paid API → calls `pay402_estimate` to check cost
2. If cost is acceptable → calls `pay402_fetch` to pay and get the data
3. Periodically checks `pay402_spending` to monitor budget
