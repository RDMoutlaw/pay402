# pay402

Universal HTTP 402 payment SDK for AI agents, MCP servers, and automated pipelines.

Handles both competing 402 payment protocols transparently:
- **L402** (Lightning Labs) — Bitcoin Lightning Network + Macaroons
- **x402** (Coinbase/Cloudflare) — USDC/stablecoins on Base and Solana

## Install

```bash
npm install pay402
```

## Quick Start

The fastest way to get running — configure wallets via environment variables:

```bash
# Set at least one wallet
export EVM_PRIVATE_KEY=0x...           # for x402 (Base/USDC)
# or
export LND_HOST=https://localhost:8080  # for L402 (Lightning)
export LND_MACAROON=hex-encoded-macaroon

# Set spend limits
export PAY402_MAX_DAILY=10.00
export PAY402_MAX_PER_REQUEST=1.00
```

```typescript
import { fromEnv } from "pay402";

const client = fromEnv();

const res = await client.fetch("https://api.example.com/premium-data");
const data = await res.json();
```

That's it. The client auto-detects which wallets are configured, handles 402 responses, pays, retries, and caches tokens. See [`.env.example`](.env.example) for all available options.

### Try it locally

```bash
git clone https://github.com/RDMoutlaw/pay402.git && cd pay402
npm install
npx tsx examples/mock-server.ts   # Terminal 1: starts a 402-gated server
npx tsx examples/client-test.ts   # Terminal 2: pays and gets access
```

## Manual Configuration

For full control, configure the client directly:

```typescript
import { pay402Fetch } from "pay402";

const fetch402 = pay402Fetch({
  wallets: [
    {
      type: "lightning",
      lndHost: process.env.LND_HOST!,
      lndMacaroon: process.env.LND_MACAROON!,
    },
    {
      type: "evm",
      privateKey: process.env.EVM_PRIVATE_KEY! as `0x${string}`,
      chain: "base",
    },
    {
      type: "solana",
      secretKey: process.env.SOLANA_SECRET_KEY!,
      cluster: "mainnet-beta",
    },
  ],
  autoFetchBtcPrice: true,
  logLevel: "info",
  spendControls: {
    global: { maxDaily: 10.0, maxPerRequest: 2.0 },
    denylist: ["https://*.untrusted.com/**"],
  },
});

const res = await fetch402("https://api.example.com/premium-data");
const data = await res.json();
```

### Class API

```typescript
import { Pay402Client } from "pay402";

const client = new Pay402Client({
  wallets: [{ type: "lightning", lndHost: "...", lndMacaroon: "..." }],
  btcPriceUsd: 60000,
  maxSinglePaymentUsd: 5,
  onPayment: (record) => {
    console.log(`Paid $${record.amountUsd} via ${record.rail} to ${record.endpoint}`);
  },
});

const res = await client.fetch("https://api.example.com/data");

// Call destroy() when done to stop background tasks (BTC price refresh)
client.destroy();
```

### Axios Interceptor

```typescript
import axios from "axios";
import { Pay402Client } from "pay402";

const client = new Pay402Client({ wallets: [...] });

axios.interceptors.request.use((config) => client.intercept(config));
```

## Server Middleware — Express

```typescript
import express from "express";
import { pay402Middleware } from "pay402";

const app = express();

app.use(
  pay402Middleware({
    pricing: {
      "/api/premium/*": { l402: 1000, x402: 500000 }, // 1000 sats or 0.50 USDC
      "/api/data": { x402: 100000 },                   // 0.10 USDC only
    },
    acceptedRails: ["l402", "x402"],
    verifyL402: (macaroon, preimage) => { /* your verification logic */ },
    verifyX402: (payload) => { /* your verification logic */ },
    x402PayTo: "0xYourAddress",
    x402Asset: "0xUSDCContractAddress",
    x402Network: "base",
    onPaymentReceived: ({ rail, route, amount }) => {
      console.log(`Received payment on ${rail} for ${route}`);
    },
  })
);

app.get("/api/premium/report", (req, res) => {
  res.json({ data: "premium content" });
});
```

## MCP Payment Wrapper

Gate MCP tools behind payment without modifying tool implementations.

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpPaymentWrapper } from "pay402";

const server = new McpServer({ name: "my-server", version: "1.0.0" });

// Wrap BEFORE registering tools
mcpPaymentWrapper({
  server,
  pricing: {
    "premium-analysis": { l402: 500, x402: 250000 },
    "generate-report": { x402: 1000000 },
  },
  acceptedRails: ["l402", "x402"],
  verifyL402: (macaroon, preimage) => true,
  verifyX402: (payload) => true,
  x402PayTo: "0xYourAddress",
  x402Asset: "0xUSDC",
});

// Register tools as normal — payment is handled by the wrapper
server.registerTool("premium-analysis", { description: "..." }, async (args) => {
  return { content: [{ type: "text", text: "analysis result" }] };
});
```

When a tool is called without payment, the wrapper returns a structured error:

```json
{
  "error": "payment_required",
  "version": "pay402/1.0",
  "challenges": [
    { "rail": "l402", "amountSats": 500 },
    { "rail": "x402", "network": "base", "amountSmallestUnit": 250000, "payTo": "0x...", "asset": "0x...", "maxTimeoutSeconds": 60 }
  ]
}
```

The calling client retries with proof in the `_payment_proof` parameter.

## Configuration Reference

### Wallet Types

| Type | Required Fields | Optional |
|------|----------------|----------|
| `lightning` | `lndHost`, `lndMacaroon` | `tlsCert` |
| `evm` | `privateKey` (0x-prefixed), `chain` | `rpcUrl`, `facilitatorUrl` |
| `solana` | `secretKey`, `cluster` | `facilitatorUrl` |

### Spend Controls

```typescript
{
  perEndpoint: {
    "https://api.example.com/*": { maxPerRequest: 0.50, maxDaily: 5.00 }
  },
  global: {
    maxPerRequest: 2.00,  // USD
    maxHourly: 10.00,     // rolling window
    maxDaily: 50.00,      // rolling window
  },
  railPreference: ["x402-base", "l402"],  // or "cheapest"
  allowlist: ["https://trusted.com/**"],
  denylist: ["https://*.evil.com/**"],
  dryRun: false,
}
```

For a complete guide on configuring spend policies for autonomous agents — budget tiers, approval workflows, multi-agent setups, and emergency controls — see [Agent Spend Policy Guide](docs/agent-spend-policy.md).

### Dry Run Mode

```typescript
const client = new Pay402Client({
  wallets: [...],
  spendControls: { dryRun: true },
});

const res = await client.fetch("https://api.example.com/data");
const estimate = await res.json();
// { rail: "x402-base", estimatedCostUsd: 1.0, wouldExceedLimits: false }
```

## Error Handling

All errors extend `Pay402Error`:

| Error | When |
|-------|------|
| `NoCompatibleRailError` | No adapter matches any advertised rail, or no wallet configured |
| `SpendLimitExceededError` | Any spend control check fails |
| `PaymentFailedError` | Adapter `pay()` threw — no auto-retry (money at stake) |
| `PaymentInFlightError` | LND returned IN_FLIGHT — outcome unknown |
| `PaymentVerificationError` | Server still returned 402 after payment |
| `InvoiceExpiredError` | BOLT11 invoice expired before payment attempt |

```typescript
import { SpendLimitExceededError, PaymentFailedError } from "pay402";

try {
  await client.fetch("https://api.example.com/data");
} catch (err) {
  if (err instanceof SpendLimitExceededError) {
    console.log(`Limit hit: ${err.limitType}, tried $${err.attemptedAmountUsd}`);
  }
  if (err instanceof PaymentFailedError) {
    console.log(`Payment failed on ${err.rail}: ${err.underlyingError.message}`);
  }
}
```

## Logging

Structured JSON logging via [pino](https://github.com/pinojs/pino). Set via config or env var:

```typescript
const client = new Pay402Client({ wallets: [...], logLevel: "debug" });
```

Or: `PAY402_LOG_LEVEL=debug` (silent | fatal | error | warn | info | debug | trace)

Logs payment events, cache hits, rail selection, and challenge parsing at appropriate levels.

## Live BTC Price

```typescript
// Auto-fetch and refresh every 5 minutes (CoinGecko)
const client = new Pay402Client({
  wallets: [...],
  autoFetchBtcPrice: true,
  btcPriceUsd: 60000, // fallback until first fetch completes
});

// Or use the provider directly
import { createBtcPriceProvider } from "pay402";

const provider = createBtcPriceProvider({ initialPrice: 60000 });
console.log(provider.getPrice()); // latest price
provider.stop(); // cleanup
```

## Security

This SDK handles private keys and real money. Keep these in mind:

- **Never hardcode private keys.** Load them from environment variables or a secret manager.
- **The x402 facilitator is a trusted third party.** When using x402, your signed EIP-3009 authorization is submitted to a facilitator (default: `x402.org`). The facilitator executes the on-chain transfer. A malicious facilitator could withhold or front-run transactions. Use `facilitatorUrl` to point to a facilitator you trust.
- **Spend controls are your safety net.** Always configure `maxSinglePaymentUsd` and `global.maxDaily` for autonomous agents. The default hard ceiling is $10 per payment.
- **No auto-retry after payment failure.** If a payment fails, the SDK throws immediately. It does not try another rail — money may have already left your wallet.
- **No auto-fallback between rails.** Rail selection happens before payment. Once a rail is chosen and payment begins, there's no switching.

To report a security vulnerability, please open a private issue or email the maintainers directly.

## How It Works

1. Client makes a request to a 402-gated endpoint
2. Server returns `402` with `WWW-Authenticate` (L402) and/or `X-Payment-Required` (x402) headers
3. SDK parses challenges from both headers
4. Checks token cache — if valid cached proof exists, skips payment
5. Runs spend control checks — blocks if any limit would be exceeded
6. Selects optimal rail based on wallet availability and preference config
7. Executes payment via the matching rail adapter
8. Retries the original request with proof-of-payment headers
9. Caches the token for future requests
10. Returns the response — caller never sees the 402

## Contributing

```bash
git clone https://github.com/RDMoutlaw/pay402.git
cd pay402
npm install
npm test          # run tests
npm run typecheck # type-check without emitting
```

PRs welcome. Please include tests for new functionality.

## License

MIT
