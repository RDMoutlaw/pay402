import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Pay402Client } from "../client/pay402-client.js";
import { fromEnv } from "../client/from-env.js";
import type { Pay402ClientConfig } from "../types/config.js";

export interface RegisterPay402ToolsConfig {
  /** Pre-built client instance. If not provided, creates one via fromEnv(). */
  client?: Pay402Client;
  /** Config overrides passed to fromEnv() when client is not provided */
  clientConfig?: Partial<Pay402ClientConfig>;
}

/**
 * Register pay402 tools on an MCP server for agent integration.
 *
 * Tools:
 * - pay402_fetch: Fetch URL with automatic 402 payment
 * - pay402_estimate: Dry-run cost estimation
 * - pay402_spending: View spending summary
 * - pay402_balance: Check wallet balances
 */
export function registerPay402Tools(
  server: McpServer,
  config?: RegisterPay402ToolsConfig,
): void {
  const client = config?.client ?? fromEnv(config?.clientConfig);

  // Create a dry-run client for estimation
  const dryRunClient = config?.client
    ? null
    : fromEnv({
        ...config?.clientConfig,
        spendControls: {
          ...config?.clientConfig?.spendControls,
          dryRun: true,
        },
      });

  // pay402_fetch — Fetch URL with automatic 402 payment
  server.registerTool(
    "pay402_fetch",
    {
      description:
        "Fetch a URL with automatic HTTP 402 payment handling. Pays and retries if the server requires payment.",
      inputSchema: {
        url: z.string().describe("The URL to fetch"),
        method: z
          .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
          .optional()
          .describe("HTTP method (default: GET)"),
        headers: z
          .record(z.string(), z.string())
          .optional()
          .describe("Additional request headers"),
        body: z
          .string()
          .optional()
          .describe("Request body (for POST/PUT/PATCH)"),
      },
    },
    async ({ url, method, headers, body }) => {
      try {
        const response = await client.fetch(url, {
          method: method ?? "GET",
          headers: headers as Record<string, string> | undefined,
          body,
        });

        const responseBody = await response.text();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: response.status,
                headers: Object.fromEntries(response.headers.entries()),
                body: responseBody,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: (err as Error).message,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // pay402_estimate — Dry-run cost estimation
  server.registerTool(
    "pay402_estimate",
    {
      description:
        "Estimate the cost of fetching a URL without actually paying. Returns the estimated cost, rail, and whether it would exceed spending limits.",
      inputSchema: {
        url: z.string().describe("The URL to estimate cost for"),
        method: z
          .string()
          .optional()
          .describe("HTTP method (default: GET)"),
      },
    },
    async ({ url, method }) => {
      const estimator = dryRunClient ?? client;
      try {
        const response = await estimator.fetch(url, {
          method: method ?? "GET",
        });

        const result = await response.text();

        return {
          content: [
            {
              type: "text" as const,
              text: result,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: (err as Error).message,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // pay402_spending — View spending summary
  server.registerTool(
    "pay402_spending",
    {
      description:
        "View a summary of spending by period (hour, day, or all time), broken down by payment rail.",
      inputSchema: {
        period: z
          .enum(["hour", "day", "all"])
          .optional()
          .describe("Time period (default: all)"),
      },
    },
    async ({ period }) => {
      const summary = client.getSpendingSummary(period);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(summary),
          },
        ],
      };
    },
  );

  // pay402_balance — Check wallet balances
  server.registerTool(
    "pay402_balance",
    {
      description:
        "Check the balance of configured wallets. Currently supported for Arkade wallets.",
    },
    async () => {
      try {
        const balances = await client.getBalances();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ wallets: balances }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: (err as Error).message,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
