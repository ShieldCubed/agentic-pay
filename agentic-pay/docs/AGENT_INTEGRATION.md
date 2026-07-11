# Integrating third-party agents

There are two agent-facing surfaces. Use whichever matches your agent
stack — both call the same `core/railManager.js`, so behavior (spend
limits, idempotency, ledger) is identical either way.

## Option A: MCP (Model Context Protocol)

Use this if your agent runs in Claude Desktop, Claude Code, or any other
MCP-compatible client.

1. Start the MCP server manually to confirm it runs cleanly:
   ```bash
   node server/mcpServer.mjs
   ```
   (It will sit waiting for stdio input — that's normal. Ctrl+C to stop.)

2. Register it with your MCP client. Config file locations:
   - **Claude Desktop, macOS:**
     `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Claude Desktop, Windows:**
     `%APPDATA%\Claude\claude_desktop_config.json`
   - **Claude Desktop, Linux:**
     `~/.config/Claude/claude_desktop_config.json`

   Add:
   ```json
   {
     "mcpServers": {
       "agentic-pay": {
         "command": "node",
         "args": ["/absolute/path/to/agentic-pay/server/mcpServer.mjs"],
         "env": {
           "AGENTIC_PAY_AGENT_ID": "claude-desktop-agent"
         }
       }
     }
   }
   ```

3. Restart the client. Tools exposed: `list_supported_rails`,
   `get_address`, `get_balance`, `create_invoice`, `send_payment`.

4. Set that agent's spend policy in `config/config.json` under
   `agentPolicies["claude-desktop-agent"]` — match the `AGENTIC_PAY_AGENT_ID`
   you set above.

## Option B: REST API (any HTTP-capable agent framework)

Use this for LangChain, custom AutoGPT-style loops, n8n, or anything
that can make HTTP calls and read JSON.

1. Start the API:
   ```bash
   node server/restApi.js
   ```

2. Issue the agent an API key by adding it to `config/config.json`:
   ```json
   "apiKeys": { "sk-your-generated-key": "your-agent-id" }
   ```
   Generate a real key with, e.g., `openssl rand -hex 32` — don't ship
   the example key.

3. Describe the tool to your agent framework. A minimal OpenAPI-style
   tool description your framework can adapt:

   | Endpoint | Method | Purpose |
   |---|---|---|
   | `/v1/rails` | GET | List supported assets |
   | `/v1/address/:asset` | GET | Get receiving address |
   | `/v1/balance/:asset` | GET | Get current balance |
   | `/v1/invoice` | POST | Create an invoice `{asset, amount, memo}` |
   | `/v1/send` | POST | Send funds `{asset, to, amount, memo, idempotencyKey, confirmed}` |

   All requests need header `x-api-key: <key>`.

4. **Always generate a fresh, unique `idempotencyKey` per logical
   payment intent** — not per HTTP retry. If your agent framework retries
   failed requests automatically, reuse the same key across those retries
   so a network hiccup can't cause a duplicate send.

## Handling `CONFIRMATION_REQUIRED`

Any send at or above `confirmationFloorUsd` for that agent's policy will
be rejected with HTTP 202 (REST) or `isError: true` (MCP) and
`code: "CONFIRMATION_REQUIRED"`. This is intentional friction: your
integration should surface this to a human, and only re-issue the same
call with `confirmed: true` after that human has actually reviewed it —
**never** wire `confirmed: true` to be set automatically by the same
agent that requested the send, or the confirmation floor provides no
real protection.
