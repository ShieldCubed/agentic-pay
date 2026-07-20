# Agentic Pay    <img width="512" height="512" alt="agentic-pay-avatar" src="https://github.com/user-attachments/assets/209da2e6-5754-4198-824f-06e6f9df44f4" />


A cross-platform payment engine that lets third-party AI agents send and
receive payments over seven crypto rails: **BTC, ETH, USDT, USDC, XRP,
XMR, ZEC**.

One Node.js core runs unmodified on **Linux, Windows, and macOS**. The same
backend is reachable from **iOS and Android** via an installable Progressive
Web App (PWA) — there is no separate native mobile codebase to maintain.

## Architecture

```
                     ┌───────────────────────────┐
                     │   core/railManager.js     │  <- one call-site for
                     │  (policy + ledger + auth) │     every asset
                     └─────────────┬─────────────┘
                                   │
        ┌───────────┬─────────────┼─────────────┬───────────┬──────────┐
        │            │             │             │           │          │
     rails/btc   rails/eth    rails/xrp     rails/xmr    rails/zec       │
     (bitcoinjs) (ethers.js,  (xrpl.js)   (JSON-RPC to  (JSON-RPC to     │
                  ETH+USDT+                monero-       zcashd)         │
                  USDC ERC20)              wallet-rpc)                   │
                                                                          │
        Agent-facing surfaces (both call railManager, never a rail       │
        adapter directly):                                               │
        ┌────────────────────────┐   ┌───────────────────────────┐      │
        │ server/restApi.js      │   │ server/mcpServer.mjs      │      │
        │ HTTP/JSON, API-key     │   │ MCP stdio server for       │      │
        │ auth, for any HTTP-    │   │ Claude / other MCP-        │      │
        │ capable agent stack    │   │ compatible agent clients   │      │
        └────────────────────────┘   └───────────────────────────┘      │
                                                                          │
        Human-facing surfaces:                                           │
        ┌────────────────────────┐   ┌───────────────────────────┐      │
        │ cli/index.js           │   │ web/ (PWA)                │      │
        │ Linux/Windows/macOS    │   │ served by server/          │      │
        │ terminal                │   │ staticWeb.js, installable  │      │
        │                        │   │ on iOS/Android home screen │      │
        └────────────────────────┘   └───────────────────────────┘      │
```

Every send, from any surface, passes through `core/limits.js` (per-agent
spend caps + human-confirmation floor) and `core/ledger.js` (idempotency,
so a retried tool call can never double-pay).

## Quick start (any OS with Node.js 18+)

```bash
git clone <this repo>          # or unzip the delivered archive
cd agentic-pay
npm install

cp config/.env.example .env
cp config/config.example.json config/config.json
# edit both files — see docs/SETUP_<YOUR_OS>.md for exact values per rail

npm run start:rest     # REST API on :8787
npm run start:web      # PWA on :8788 (optional, for mobile/browser access)
npm run start:mcp      # MCP stdio server (for Claude Desktop / Claude Code)
node cli/index.js rails   # sanity check from the terminal
```

**Start on testnets first.** Every rail's example config defaults to a
testnet or requires you to explicitly fill in mainnet values — this is
intentional. Do not point real funds at this system until you've reviewed
`core/limits.js` and set spend caps you're comfortable with.

## Hosted (custodial) — skip the setup

Don't want to run your own node? Aumnium operates a hosted instance at
**https://api.aumnium.tech** — deposit USDC, get a spendable custodial
balance, and start sending across all seven rails without installing or
funding anything yourself.

This is a **different trust model** than the self-hosted instructions
above: your funds sit in a pooled wallet operated by Aumnium (not your
own keys), and each send is charged a 1% fee plus network cost, deducted
from your balance. The self-hosted path above remains fully non-custodial;
this hosted path trades that for convenience.

```bash
# 1. Get your deposit address
curl -H "x-api-key: YOUR_KEY" https://api.aumnium.tech/v1/deposit/address

# 2. Send USDC to that address on Ethereum mainnet

# 3. Claim your deposit once it confirms
curl -X POST -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \
  -d \'{"txHash":"0x..."}\' \
  https://api.aumnium.tech/v1/deposit/claim

# 4. Send payments (billed per-call via x402, USDC on Base)
curl -X POST -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \
  -d \'{"asset":"USDC","to":"0x...","amount":1,"idempotencyKey":"unique-key"}\' \
  https://api.aumnium.tech/v1/send
```

Contact team@spacenet.network for an API key. Full endpoint list at
[https://api.aumnium.tech](https://api.aumnium.tech).

## Where to go next

- [`docs/SETUP_LINUX.md`](docs/SETUP_LINUX.md)
- [`docs/SETUP_WINDOWS.md`](docs/SETUP_WINDOWS.md)
- [`docs/SETUP_MACOS.md`](docs/SETUP_MACOS.md)
- [`docs/SETUP_MOBILE.md`](docs/SETUP_MOBILE.md) — iOS and Android via PWA
- [`docs/AGENT_INTEGRATION.md`](docs/AGENT_INTEGRATION.md) — wiring up
  Claude, MCP clients, or any HTTP-based agent framework
- [`docs/SECURITY.md`](docs/SECURITY.md) — key management, spend limits,
  and legal/regulatory considerations — **read this before sending real
  funds**

## What's genuinely production-ready here vs. what's a starting point

- **Production-shaped:** the policy engine (per-tx cap, daily cap,
  confirmation floor, address allowlisting), the idempotent ledger, and
  the unified rail interface.
- **Starting point, needs hardening for real money at scale:** the
  JSON-file ledger (swap for a real database under load), the static
  USD price table (wire in a live price feed), and key storage (move
  from `.env` to an OS keychain or HSM/KMS for anything beyond
  development — see `core/keystore.js` for the extension point).

## License

agentic-pay is licensed under the **Business Source License 1.1** (see
[`LICENSE`](LICENSE)). In plain terms:

- You can use, modify, and self-host this freely — for yourself, your
  own organization, or your own agents, including production use.
- You **cannot** turn around and offer it as a competing hosted/managed
  payments-as-a-service product to third parties without a commercial
  license.
- On **2030-07-14**, this version automatically converts to the Apache
  License 2.0 — fully open source, no restrictions.

Want a commercial license for a hosted/managed offering before then?
Contact team@spacenet.network.


