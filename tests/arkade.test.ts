import { describe, it, expect, vi } from "vitest";
import type { ArkadeWalletConfig } from "../src/types/wallet.js";

// Mock @arkade-os/sdk before importing
vi.mock("@arkade-os/sdk", () => {
  const mockWallet = {
    sendBitcoin: vi.fn().mockResolvedValue({ txId: "vtxo-tx-001" }),
    getAddress: vi.fn().mockResolvedValue("ark1sender"),
    getBalance: vi.fn().mockResolvedValue({ total: 100000, confirmed: 90000, unconfirmed: 10000 }),
  };

  return {
    MnemonicIdentity: vi.fn(),
    Wallet: vi.fn().mockImplementation(() => mockWallet),
    __mockWallet: mockWallet,
  };
});

import { getOrCreateArkadeWallet } from "../src/rails/arkade.js";

const arkadeWallet: ArkadeWalletConfig = {
  type: "arkade",
  mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  arkServerUrl: "https://arkade.computer",
  network: "testnet",
};

describe("getOrCreateArkadeWallet", () => {
  it("caches wallet instances by server URL + mnemonic prefix", async () => {
    const wallet1 = await getOrCreateArkadeWallet(arkadeWallet);
    const wallet2 = await getOrCreateArkadeWallet(arkadeWallet);
    expect(wallet1).toBe(wallet2);
  });
});
