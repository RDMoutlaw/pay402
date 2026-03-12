# pay402

**A universal payment layer for machine-to-machine commerce.**

HTTP 402 ("Payment Required") has been a reserved status code since 1997 — a placeholder for a future where software could pay for services the same way it follows redirects. That future is here. Multiple payment protocols now use 402, but they're incompatible with each other: Lightning uses macaroons and invoices, x402 uses EIP-712 signatures on Base, Solana has its own flow, and Arkade uses Bitcoin VTXOs. A client built for one can't talk to the others.

pay402 is the universal adapter. One SDK that speaks every 402 dialect, so your code — whether it's an AI agent, an MCP server, a backend service, or a script — can pay any 402-gated endpoint regardless of which payment rail it uses. Configure your wallets once, set spend limits, and `client.fetch()` handles everything: challenge parsing, rail selection, payment execution, proof caching, and automatic retry.

But pay402 goes further than just client-side payments:

- **Bridge layer** — Don't have the right wallet? pay402 routes payments across rails. An Arkade wallet can pay a Lightning invoice via Boltz atomic swap, or a USDC wallet can pay one via LendaSat. The server never knows the difference.
- **Server middleware** — Gate your own Express routes or MCP tools behind payment with a few lines of config. Multi-rail, multi-price, plug in your own verification.
- **Agent skill** — Register pay402 as MCP tools so AI agents can discover, estimate, and execute paid API calls autonomously — with spending controls that keep them on a leash.

The net effect: any software with a wallet can pay any service with a price. The payment rail becomes an implementation detail, not a compatibility barrier.

### Supported Rails

| Rail | Protocol | Currency | Network |
|------|----------|----------|---------|
| **L402** | Lightning Labs | Bitcoin (sats) | Lightning Network |
| **x402** | Coinbase | USDC | Base, Solana |

Arkade and EVM (USDC) wallets are also supported as **funding sources** via the bridge layer — they can pay L402 invoices through atomic swaps (Boltz for Arkade, LendaSat for USDC), but neither is a server-facing payment rail for L402.

## Install

```bash
npm install pay402
```

Optional peer dependencies for bridge support:

```bash
npm install @arkade-os/sdk            # Arkade wallet
npm install @arkade-os/boltz-swap     # Arkade→Lightning bridge
npm install @lendasat/lendaswap-sdk-pure  # USDC→Lightning bridge
```

## Quick Start

The fastest way to get running — configure wallets via environment variables:

```bash
# Set at least one wallet
export EVM_PRIVATE_KEY=0x...           # for x402 (Base/USDC)
# or
export LND_HOST=https://localhost:8080  # for L402 (Lightning)
export LND_MACAROON=hex-encoded-macaroon
# or
export ARKADE_MNEMONIC="your twelve word mnemonic phrase here"
export ARKADE_SERVER_URL=https://arkade.computer
export ARKADE_NETWORK=mainnet

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
    {
      type: "arkade",
      mnemonic: process.env.ARKADE_MNEMONIC!,
      arkServerUrl: process.env.ARKADE_SERVER_URL!,
      network: "mainnet",
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

## Cross-Rail Bridging

When a server requires a rail your wallet doesn't natively support, pay402 can bridge the payment. For example, an Arkade wallet can pay a Lightning (L402) invoice via a Boltz submarine swap, or a USDC (EVM) wallet can pay one via a LendaSat atomic swap.

Bridging is **opt-in** and disabled by default:

```typescript
// Arkade → Lightning
const client = new Pay402Client({
  wallets: [
    {
      type: "arkade",
      mnemonic: process.env.ARKADE_MNEMONIC!,
      arkServerUrl: "https://arkade.computer",
      network: "mainnet",
    },
  ],
  bridging: {
    enabled: true,
    maxBridgeFeeUsd: 0.50,              // max bridge fee you're willing to pay
    allowedPaths: ["arkade->l402"],      // only allow specific bridge paths
  },
  autoFetchBtcPrice: true,
});

// This works even though the server only accepts L402 (Lightning):
const res = await client.fetch("https://lightning-only-api.com/data");
```

```typescript
// USDC → Lightning
const client = new Pay402Client({
  wallets: [
    {
      type: "evm",
      privateKey: process.env.EVM_PRIVATE_KEY! as `0x${string}`,
      chain: "base",
    },
  ],
  bridging: {
    enabled: true,
    maxBridgeFeeUsd: 0.50,
    allowedPaths: ["x402-base->l402"],
    lendasat: {
      chainId: 137,                      // Polygon (default)
      tokenAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // Polygon USDC (default)
    },
  },
  autoFetchBtcPrice: true,
});

// EVM wallet pays a Lightning invoice via LendaSat gasless swap:
const res = await client.fetch("https://lightning-only-api.com/data");
```

The server sees a valid L402 preimage — it doesn't know or care how the payment was funded. Bridge fees are included in spend control checks.

Currently supported bridge paths:

| Source | Target | Provider | Peer Dependency |
|--------|--------|----------|-----------------|
| `arkade` | `l402` | Boltz submarine swap | `@arkade-os/boltz-swap` |
| `x402-base` | `l402` | LendaSat gasless atomic swap | `@lendasat/lendaswap-sdk-pure` |

## Agent Skill (MCP Client Tools)

Register pay402 as a set of tools on an MCP server so AI agents can discover and use paid APIs:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPay402Tools } from "pay402/mcp-tool";

const server = new McpServer({ name: "my-agent", version: "1.0" });
registerPay402Tools(server);
```

This registers four tools:

| Tool | Description | Key Input |
|------|-------------|-----------|
| `pay402_fetch` | Fetch a URL with automatic 402 payment | `url`, `method?`, `headers?`, `body?` |
| `pay402_estimate` | Dry-run cost estimation | `url`, `method?` |
| `pay402_spending` | View spending summary by period | `period?` (`hour`, `day`, `all`) |
| `pay402_balance` | Check wallet balances | — |

You can pass a pre-built client or let it auto-configure from environment variables:

```typescript
// With a pre-built client
const client = new Pay402Client({ wallets: [...] });
registerPay402Tools(server, { client });

// Or auto-configure from env
registerPay402Tools(server);
```

The package includes a [`SKILL.md`](SKILL.md) file for agent skill discovery.

### Programmatic Spending & Balance API

The client also exposes these methods directly:

```typescript
// Spending summary
const summary = client.getSpendingSummary("hour");
// { totalUsd: 3.50, count: 5, byRail: { l402: { totalUsd: 2.0, count: 3 }, ... } }

// Wallet balances (currently supported for Arkade wallets)
const balances = await client.getBalances();
// [{ type: "arkade", balanceSats: 50000 }, { type: "lightning", error: "balance check not supported" }]
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
      "/api/data": { x402: 100000 },                                 // 0.10 USDC only
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
    { "rail": "x402", "network": "base", "amountSmallestUnit": 250000, "payTo": "0x...", "asset": "0x...", "maxTimeoutSeconds": 60 },
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
| `arkade` | `mnemonic`, `arkServerUrl`, `network` | — |

### Environment Variables

| Variable | Wallet | Description |
|----------|--------|-------------|
| `LND_HOST` | Lightning | LND REST API host |
| `LND_MACAROON` | Lightning | Hex-encoded admin macaroon |
| `LND_TLS_CERT` | Lightning | Base64 TLS cert for self-signed nodes |
| `EVM_PRIVATE_KEY` | EVM | 0x-prefixed hex private key |
| `EVM_CHAIN` | EVM | `base` or `base-sepolia` (default: `base`) |
| `EVM_FACILITATOR_URL` | EVM | x402 facilitator URL |
| `SOLANA_SECRET_KEY` | Solana | Base58-encoded keypair |
| `SOLANA_CLUSTER` | Solana | `mainnet-beta` or `devnet` (default: `mainnet-beta`) |
| `SOLANA_FACILITATOR_URL` | Solana | x402 facilitator URL |
| `ARKADE_MNEMONIC` | Arkade | BIP-39 mnemonic phrase |
| `ARKADE_SERVER_URL` | Arkade | Arkade server URL |
| `ARKADE_NETWORK` | Arkade | `mainnet` or `testnet` (default: `mainnet`) |
| `PAY402_MAX_PER_REQUEST` | — | Max USD per request |
| `PAY402_MAX_HOURLY` | — | Max USD per rolling hour |
| `PAY402_MAX_DAILY` | — | Max USD per rolling day |
| `PAY402_BTC_PRICE_USD` | — | Static BTC price in USD |
| `PAY402_AUTO_BTC_PRICE` | — | `true` to auto-fetch from CoinGecko |
| `PAY402_LOG_LEVEL` | — | Logging level |

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

### Bridging Config

```typescript
{
  bridging: {
    enabled: true,                       // default: false
    maxBridgeFeeUsd: 1.00,              // default: $1
    allowedPaths: ["arkade->l402", "x402-base->l402"], // restrict which bridge paths are allowed
    lendasat: {                          // optional LendaSat config
      chainId: 137,                      // default: 137 (Polygon)
      tokenAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // default: Polygon USDC
    },
  },
}
```

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
| `BridgePaymentFailedError` | Bridge swap failed (includes `bridgePath` field) |

```typescript
import { SpendLimitExceededError, PaymentFailedError, BridgePaymentFailedError } from "pay402";

try {
  await client.fetch("https://api.example.com/data");
} catch (err) {
  if (err instanceof SpendLimitExceededError) {
    console.log(`Limit hit: ${err.limitType}, tried $${err.attemptedAmountUsd}`);
  }
  if (err instanceof PaymentFailedError) {
    console.log(`Payment failed on ${err.rail}: ${err.underlyingError.message}`);
  }
  if (err instanceof BridgePaymentFailedError) {
    console.log(`Bridge failed on ${err.bridgePath}: ${err.underlyingError.message}`);
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

## How It Works

1. Client makes a request to a 402-gated endpoint
2. Server returns `402` with `WWW-Authenticate` (L402) and/or `X-Payment-Required` (x402) headers
3. SDK parses challenges from all headers
4. Checks token cache — if valid cached proof exists, skips payment
5. Runs spend control checks — blocks if any limit would be exceeded
6. Selects optimal rail based on wallet availability and preference config
7. If no direct match and bridging is enabled, attempts cross-rail bridge (e.g. Arkade -> L402)
8. Executes payment via the matching rail adapter (or bridge provider)
9. Retries the original request with proof-of-payment headers
10. Caches the token for future requests
11. Returns the response — caller never sees the 402

## Security

This SDK handles private keys and real money. Keep these in mind:

- **Never hardcode private keys or mnemonics.** Load them from environment variables or a secret manager.
- **The x402 facilitator is a trusted third party.** When using x402, your signed EIP-3009 authorization is submitted to a facilitator (default: `x402.org`). The facilitator executes the on-chain transfer. A malicious facilitator could withhold or front-run transactions. Use `facilitatorUrl` to point to a facilitator you trust.
- **Bridge swaps involve a third party.** The Arkade→L402 bridge uses Boltz for submarine swaps; the USDC→L402 bridge uses LendaSat for atomic swaps. Bridge fees are included in spend control checks, but the swaps themselves are trust relationships with the respective services.
- **Spend controls are your safety net.** Always configure `maxSinglePaymentUsd` and `global.maxDaily` for autonomous agents. The default hard ceiling is $10 per payment.
- **No auto-retry after payment failure.** If a payment fails, the SDK throws immediately. It does not try another rail — money may have already left your wallet.
- **No auto-fallback between rails.** Rail selection happens before payment. Once a rail is chosen and payment begins, there's no switching.

To report a security vulnerability, please open a private issue or email the maintainers directly.

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
