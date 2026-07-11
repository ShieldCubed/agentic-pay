#!/usr/bin/env node
/**
 * server/mcpServer.mjs
 *
 * Exposes agentic-pay as an MCP (Model Context Protocol) server, so it can
 * be registered as a tool provider in Claude Desktop, Claude Code, or any
 * other MCP-compatible agent client, via stdio transport.
 *
 * This file is ESM (.mjs) because the MCP SDK ships as ESM-first; the rest
 * of this project is CommonJS, so we bridge with a dynamic import() of the
 * CommonJS core.
 *
 * Run directly:  node server/mcpServer.mjs
 *
 * To register with Claude Desktop, add to your MCP config
 * (see docs/AGENT_INTEGRATION.md for exact file locations per OS):
 *   {
 *     "mcpServers": {
 *       "agentic-pay": {
 *         "command": "node",
 *         "args": ["/absolute/path/to/agentic-pay/server/mcpServer.mjs"]
 *       }
 *     }
 *   }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const rails = require('../core/railManager.js');

// The MCP agentId is fixed per server process via env var — each agent
// that wants its own spend-limit policy should run its own instance of
// this server (or you extend this file to read agentId from the tool
// call arguments instead, if your MCP client supports passing it).
const AGENT_ID = process.env.AGENTIC_PAY_AGENT_ID || 'mcp-default-agent';

const server = new McpServer({ name: 'agentic-pay', version: '0.1.0' });

server.tool(
  'list_supported_rails',
  'List all payment rails (crypto assets) this server can send and receive.',
  {},
  async () => ({
    content: [{ type: 'text', text: JSON.stringify(rails.SUPPORTED_ASSETS) }],
  })
);

server.tool(
  'get_address',
  'Get this wallet\'s receiving address for a given asset (BTC, ETH, USDT, USDC, XRP, XMR, ZEC).',
  { asset: z.enum(rails.SUPPORTED_ASSETS) },
  async ({ asset }) => {
    const address = await rails.getAddress(asset);
    return { content: [{ type: 'text', text: JSON.stringify({ asset, address }) }] };
  }
);

server.tool(
  'get_balance',
  'Get this wallet\'s current balance for a given asset.',
  { asset: z.enum(rails.SUPPORTED_ASSETS) },
  async ({ asset }) => {
    const balance = await rails.getBalance(asset);
    return { content: [{ type: 'text', text: JSON.stringify(balance) }] };
  }
);

server.tool(
  'create_invoice',
  'Create a payment invoice (a request for payment) for a given asset and amount. Returns an address to pay to.',
  {
    asset: z.enum(rails.SUPPORTED_ASSETS),
    amount: z.number().positive(),
    memo: z.string().optional(),
  },
  async ({ asset, amount, memo }) => {
    const invoice = await rails.createInvoice({ asset, amount, memo, agentId: AGENT_ID });
    return { content: [{ type: 'text', text: JSON.stringify(invoice) }] };
  }
);

server.tool(
  'send_payment',
  'Send a payment on a given rail to a destination address. Requires a caller-supplied idempotencyKey ' +
    'to prevent duplicate sends on retry. Payments at or above the configured confirmation floor will ' +
    'be rejected with code CONFIRMATION_REQUIRED until re-sent with confirmed=true after human review — ' +
    'do not set confirmed=true yourself without an explicit human approval step.',
  {
    asset: z.enum(rails.SUPPORTED_ASSETS),
    to: z.string(),
    amount: z.number().positive(),
    memo: z.string().optional(),
    idempotencyKey: z.string(),
    confirmed: z.boolean().optional(),
  },
  async ({ asset, to, amount, memo, idempotencyKey, confirmed }) => {
    try {
      const result = await rails.sendPayment({
        agentId: AGENT_ID,
        asset,
        to,
        amount,
        memo,
        idempotencyKey,
        confirmed: !!confirmed,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: err.message, code: err.code || 'SEND_FAILED' }),
          },
        ],
        isError: true,
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
