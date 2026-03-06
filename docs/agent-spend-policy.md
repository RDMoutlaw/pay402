# Agent Spend Policy Guide

A framework for configuring pay402 spend controls when deploying autonomous agents. Adapt these guidelines to your organization's risk tolerance and use case.

## Core Principle

An agent should never be able to spend more than you'd be comfortable losing if it malfunctioned. Every dollar an agent can spend autonomously is a dollar it can spend incorrectly.

## Policy Dimensions

### 1. Budget Tiers

Define spending tiers based on the level of autonomy:

| Tier | Per-Request | Daily | Approval |
|------|------------|-------|----------|
| **Micro** | < $0.01 | < $1.00 | Fully autonomous |
| **Standard** | < $0.50 | < $10.00 | Autonomous with logging |
| **Elevated** | < $5.00 | < $50.00 | Requires prior authorization |
| **Manual** | Any | Any | Human approval per transaction |

Most agents should start at **Micro** and be promoted only after observing their behavior in production.

```typescript
// Micro tier — suitable for most autonomous agents
const client = new Pay402Client({
  wallets: [...],
  maxSinglePaymentUsd: 0.01,
  spendControls: {
    global: {
      maxPerRequest: 0.01,
      maxHourly: 0.25,
      maxDaily: 1.00,
    },
  },
});
```

```typescript
// Standard tier — for agents with known, bounded API usage
const client = new Pay402Client({
  wallets: [...],
  maxSinglePaymentUsd: 0.50,
  spendControls: {
    global: {
      maxPerRequest: 0.50,
      maxHourly: 5.00,
      maxDaily: 10.00,
    },
  },
});
```

### 2. Scope Controls — What Can Be Paid

Never give an agent a blank check on which endpoints it can pay. Use allowlists and denylists to restrict where money flows.

**Allowlist-first approach (recommended):**
Only explicitly approved services can receive payment.

```typescript
spendControls: {
  allowlist: [
    "https://api.trustedservice.com/**",
    "https://data.approvedvendor.io/v2/**",
  ],
}
```

**Denylist approach:**
Block known-bad or out-of-scope destinations. Less secure — a new malicious endpoint won't be blocked until added.

```typescript
spendControls: {
  denylist: [
    "https://*.gambling.com/**",
    "https://*.unknown-vendor.io/**",
  ],
}
```

**Per-endpoint budgets:**
Different services get different budgets based on their expected cost.

```typescript
spendControls: {
  perEndpoint: {
    "https://api.cheap-service.com/**": {
      maxPerRequest: 0.01,
      maxDaily: 0.50,
    },
    "https://api.expensive-service.com/**": {
      maxPerRequest: 1.00,
      maxDaily: 5.00,
    },
  },
}
```

### 3. Rate Controls — How Fast

Hourly limits prevent runaway loops where an agent hits the same paid endpoint repeatedly.

A healthy agent making occasional paid API calls might spend $0.10/hour. If it suddenly spends $5/hour, something is wrong. Set hourly limits to catch this.

```typescript
spendControls: {
  global: {
    maxPerRequest: 0.10,
    maxHourly: 1.00,   // catches loops
    maxDaily: 10.00,    // catches sustained misuse
  },
}
```

**Rule of thumb:** Set `maxHourly` to no more than 10x what you expect the agent to spend in a normal hour. If it's hitting that limit, investigate before raising it.

### 4. Approval Workflows

pay402 doesn't have a built-in approval system, but you can implement one using the `onPayment` callback, dry-run mode, and the error handling flow.

**Pattern: Dry-run with human approval for large payments**

```typescript
const client = new Pay402Client({
  wallets: [...],
  maxSinglePaymentUsd: 0.10, // auto-approve under $0.10
  spendControls: {
    global: { maxDaily: 5.00 },
  },
  onPayment: (record) => {
    // Log every payment to your audit system
    auditLog.write(record);
  },
});

// For requests that might be expensive, dry-run first
async function payWithApproval(url: string) {
  const dryClient = new Pay402Client({
    wallets: [...],
    spendControls: { dryRun: true },
  });

  const estimate = await dryClient.fetch(url);
  const { estimatedCostUsd } = await estimate.json();

  if (estimatedCostUsd > 0.10) {
    const approved = await requestHumanApproval(url, estimatedCostUsd);
    if (!approved) return null;
  }

  return client.fetch(url);
}
```

**Pattern: Slack/webhook notification on spend**

```typescript
const client = new Pay402Client({
  wallets: [...],
  onPayment: async (record) => {
    // Always log
    console.log(`[pay402] ${record.rail} $${record.amountUsd} → ${record.endpoint}`);

    // Alert on unusual spending
    if (record.amountUsd > 1.00) {
      await sendSlackAlert(
        `Agent spent $${record.amountUsd} on ${record.endpoint} via ${record.rail}`
      );
    }
  },
});
```

### 5. Rail Preference as Policy

Rail selection isn't just a cost optimization — it's a policy decision.

| Policy | Config | Rationale |
|--------|--------|-----------|
| Cheapest first | `railPreference: "cheapest"` | Minimize cost |
| Stablecoins only | `railPreference: ["x402-base"]` | Avoid BTC price volatility |
| Lightning only | `railPreference: ["l402"]` | Instant settlement, no facilitator trust |
| Prefer on-chain | `railPreference: ["x402-base", "x402-solana", "l402"]` | Auditable on-chain trail |

If your organization requires auditable payments, prefer x402 (on-chain transactions have public receipts). If you need to avoid third-party trust, prefer L402 (direct peer-to-peer over Lightning, no facilitator).

### 6. Audit Trail

Every payment should be logged. At minimum, capture:

```typescript
onPayment: (record) => {
  // record contains: { timestamp, amountUsd, endpoint, rail }
  logger.info({
    event: "agent_payment",
    agent: AGENT_ID,
    ...record,
  });
}
```

For compliance-heavy environments, also log:
- The challenge received (what the server asked for)
- The proof sent (what was paid, minus sensitive fields)
- Whether the response was successful after payment
- Cumulative spend for the agent that day

### 7. Multi-Agent Environments

When running multiple agents, each should have its own `Pay402Client` with its own budget. Do not share a client instance across agents — spend tracking is per-client.

```typescript
function createAgentClient(agentId: string, tier: "micro" | "standard") {
  const limits = {
    micro:    { maxPerRequest: 0.01, maxHourly: 0.25, maxDaily: 1.00 },
    standard: { maxPerRequest: 0.50, maxHourly: 5.00, maxDaily: 10.00 },
  };

  return new Pay402Client({
    wallets: [...],
    maxSinglePaymentUsd: limits[tier].maxPerRequest,
    spendControls: {
      global: limits[tier],
    },
    onPayment: (record) => {
      auditLog.write({ agentId, ...record });
    },
  });
}

const researchAgent = createAgentClient("research-bot", "micro");
const analysisAgent = createAgentClient("analysis-bot", "standard");
```

### 8. Emergency Controls

Always have a way to cut off spending immediately.

**Kill switch:** Deploy agents with an allowlist that you control. Emptying the allowlist (or switching to a universal denylist) stops all payments without redeploying the agent.

**Wallet isolation:** Use a dedicated wallet for each agent or agent class. Fund it with only what you're willing to spend. When the wallet is empty, payments fail safely.

**Monitoring alerts:** Set alerts on:
- Any `SpendLimitExceededError` (agent is trying to overspend)
- Any `PaymentFailedError` (something is broken)
- Hourly spend exceeding 50% of the daily limit (agent is burning through budget)

## Example: Production Policy for a Research Agent

```typescript
const client = new Pay402Client({
  wallets: [
    {
      type: "evm",
      privateKey: process.env.AGENT_WALLET_KEY as `0x${string}`,
      chain: "base",
      // Dedicated wallet, funded with $50 max
    },
  ],
  maxSinglePaymentUsd: 0.25,
  autoFetchBtcPrice: true,
  logLevel: "info",
  spendControls: {
    global: {
      maxPerRequest: 0.25,
      maxHourly: 2.00,
      maxDaily: 10.00,
    },
    perEndpoint: {
      "https://api.data-provider.com/**": {
        maxPerRequest: 0.10,
        maxDaily: 5.00,
      },
    },
    allowlist: [
      "https://api.data-provider.com/**",
      "https://api.research-tool.io/**",
    ],
    railPreference: ["x402-base"],
  },
  onPayment: (record) => {
    metrics.increment("agent.payment", { rail: record.rail });
    metrics.gauge("agent.daily_spend", record.amountUsd);
    auditLog.write({
      agent: "research-bot",
      ...record,
    });
  },
});
```

This agent:
- Can only pay two approved services
- Cannot spend more than $0.25 in a single request
- Cannot spend more than $2/hour or $10/day
- Uses only on-chain stablecoins (auditable)
- Has a wallet funded with $50 (hard ceiling even if all software controls fail)
- Logs every payment for audit
