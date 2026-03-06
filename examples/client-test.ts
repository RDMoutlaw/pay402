import { Pay402Client } from "../src/client/pay402-client.js";

// ⚠️  This is Hardhat's default account #0 — a publicly known test key.
// NEVER use this key on mainnet. For real usage, load from environment:
//   process.env.EVM_PRIVATE_KEY
const HARDHAT_TEST_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const privateKey = (process.env.EVM_PRIVATE_KEY ?? HARDHAT_TEST_KEY) as `0x${string}`;

const client = new Pay402Client({
  wallets: [
    {
      type: "evm",
      privateKey,
      chain: "base-sepolia",
      facilitatorUrl: "http://localhost:3402/facilitate",
    },
  ],
  maxSinglePaymentUsd: 1,
  logLevel: "debug",
  spendControls: {
    global: { maxDaily: 5.0 },
  },
});

async function main() {
  console.log("\n--- Free endpoint ---");
  const free = await client.fetch("http://localhost:3402/api/free");
  console.log("Status:", free.status);
  console.log("Body:", await free.json());

  console.log("\n--- Premium endpoint (first call — will pay) ---");
  const premium1 = await client.fetch("http://localhost:3402/api/premium");
  console.log("Status:", premium1.status);
  console.log("Body:", await premium1.json());

  console.log("\n--- Premium endpoint (second call — should use cache) ---");
  const premium2 = await client.fetch("http://localhost:3402/api/premium");
  console.log("Status:", premium2.status);
  console.log("Body:", await premium2.json());

  console.log("\n--- Dry run ---");
  const dryClient = new Pay402Client({
    wallets: [
      {
        type: "evm",
        privateKey,
        chain: "base-sepolia",
        facilitatorUrl: "http://localhost:3402/facilitate",
      },
    ],
    spendControls: { dryRun: true },
    logLevel: "debug",
  });

  const dryResult = await dryClient.fetch(
    "http://localhost:3402/api/premium",
  );
  console.log("Dry run result:", await dryResult.json());

  client.destroy();
}

main().catch(console.error);
