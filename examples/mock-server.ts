import express from "express";
import { pay402Middleware } from "../src/middleware/express.js";

const app = express();
app.use(express.json());

// Mock facilitator — accepts any signed payload
app.post("/facilitate", (req, res) => {
  console.log("Facilitator received:", JSON.stringify(req.body, null, 2));
  res.json({ success: true });
});

app.use(
  pay402Middleware({
    pricing: {
      "/api/premium": { x402: 100000 }, // 0.10 USDC
    },
    acceptedRails: ["x402"],
    verifyX402: (payload) => {
      // Accept any proof for testing
      console.log("Received payment proof:", payload);
      return true;
    },
    x402PayTo: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    x402Asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    x402Network: "base-sepolia",
    onPaymentReceived: ({ rail, route, amount }) => {
      console.log(`Payment received: ${rail} on ${route} for ${amount}`);
    },
  }),
);

app.get("/api/free", (_req, res) => {
  res.json({ message: "This is free!" });
});

app.get("/api/premium", (_req, res) => {
  res.json({ message: "Premium content unlocked!", secret: 42 });
});

app.listen(3402, () => {
  console.log("Mock 402 server running on http://localhost:3402");
  console.log("  GET /api/free     — no payment required");
  console.log("  GET /api/premium  — 402, requires x402 payment");
});
