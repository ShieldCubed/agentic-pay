'use strict';
/**
 * server/restApi.js
 *
 * Plain HTTP/JSON REST API for any agent framework that calls tools over
 * HTTP (LangChain, custom AutoGPT-style agents, n8n, etc.). Every request
 * must include a valid API key mapped to an agentId — this is how the
 * policy engine (core/limits.js) knows whose spend limits to apply.
 *
 * Run: node server/restApi.js
 * Default port: 8787 (override with PORT env var)
 */

require('dotenv').config();
const express = require('express');
const rails = require('../core/railManager');

const app = express();

const { paymentMiddleware, x402ResourceServer } = require('@x402/express');
const { ExactEvmScheme } = require('@x402/evm/exact/server');
const { HTTPFacilitatorClient } = require('@x402/core/server');

const PAY_TO = '0x33f765ff1ff70A19be91c4ADEE62ee16Da46b866';
const facilitatorClient = new HTTPFacilitatorClient({
  url: process.env.X402_FACILITATOR_URL || 'https://facilitator.xpay.sh',
});
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register('eip155:8453', new ExactEvmScheme()); // Base mainnet

app.use(paymentMiddleware(
  {
    'GET /v1/address/:asset': { accepts: { scheme: 'exact', price: '$0.001', network: 'eip155:8453', payTo: PAY_TO }, description: 'Get receiving address' },
    'GET /v1/balance/:asset': { accepts: { scheme: 'exact', price: '$0.001', network: 'eip155:8453', payTo: PAY_TO }, description: 'Check balance' },
    'POST /v1/invoice':       { accepts: { scheme: 'exact', price: '$0.005', network: 'eip155:8453', payTo: PAY_TO }, description: 'Create invoice' },
    'POST /v1/send':          { accepts: { scheme: 'exact', price: '$0.01',  network: 'eip155:8453', payTo: PAY_TO }, description: 'Send payment' },
  },
  resourceServer,
));

app.use(express.json());

// --- API key -> agentId mapping -------------------------------------
// Populate via config/config.json -> apiKeys, e.g.:
//   { "apiKeys": { "sk-agent-abc123": "research-agent-1" } }
const limits = require('../core/limits');
function apiKeyToAgentId(key) {
  const cfg = limits.loadPolicy();
  const mapping = cfg.apiKeys || {};
  return mapping[key] || null;
}

function requireAuth(req, res, next) {
  const key = req.header('x-api-key');
  const agentId = key && apiKeyToAgentId(key);
  if (!agentId) {
    return res.status(401).json({ error: 'Missing or invalid x-api-key header.' });
  }
  req.agentId = agentId;
  next();
}

// --- Admin auth (separate keyspace from per-agent apiKeys) -------------
// For internal dashboards/tooling only. Admin keys see ALL agents' data,
// unscoped by agentId. Configure in config/config.json -> adminApiKeys.
function requireAdminAuth(req, res, next) {
  const key = req.header('x-api-key');
  const cfg = limits.loadPolicy();
  const adminKeys = cfg.adminApiKeys || [];
  if (!key || !adminKeys.includes(key)) {
    return res.status(401).json({ error: 'Missing or invalid admin x-api-key header.' });
  }
  next();
}

// --- Routes ------------------------------------------------------------

app.get('/', (req, res) => {
  res.json({
    service: 'agentic-pay',
    description: 'Hosted, custodial payment engine for AI agents. Deposit USDC, get a spendable balance, send across 7 crypto rails via REST or MCP.',
    docs: 'https://github.com/ShieldCubed/agentic-pay',
    website: 'https://aumnium.tech/agentic-pay',
    supportedRails: ['BTC', 'ETH', 'USDT', 'USDC', 'XRP', 'XMR', 'ZEC'],
    gettingStarted: {
      step1: 'Contact us for an API key (see website)',
      step2: 'GET /v1/deposit/address to get the USDC deposit address',
      step3: 'Send USDC to that address on Ethereum mainnet',
      step4: 'POST /v1/deposit/claim with your transaction hash to credit your balance',
      step5: 'POST /v1/send to send payments — pay-per-call via x402 (USDC on Base)',
    },
    endpoints: {
      'GET /v1/rails': 'List supported assets',
      'GET /v1/address/:asset': 'Get receiving address (x402)',
      'GET /v1/balance/:asset': 'Check balance (x402)',
      'GET /v1/balance-custodial': 'Check custodial USDC balance',
      'GET /v1/deposit/address': 'Get USDC deposit address',
      'POST /v1/deposit/claim': 'Claim a deposit by tx hash',
      'POST /v1/invoice': 'Create invoice (x402)',
      'POST /v1/send': 'Send payment (x402)',
    },
  });
});

app.get('/v1/rails', (req, res) => {
  res.json({ supported: rails.SUPPORTED_ASSETS });
});

app.get('/v1/address/:asset', requireAuth, async (req, res) => {
  try {
    const address = await rails.getAddress(req.params.asset.toUpperCase());
    res.json({ asset: req.params.asset.toUpperCase(), address });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/v1/balance/:asset', requireAuth, async (req, res) => {
  try {
    const balance = await rails.getBalance(req.params.asset.toUpperCase());
    res.json(balance);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/v1/invoice', requireAuth, async (req, res) => {
  try {
    const { asset, amount, memo } = req.body;
    const invoice = await rails.createInvoice({
      asset: String(asset).toUpperCase(),
      amount,
      memo,
      agentId: req.agentId,
    });
    res.json(invoice);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/v1/send', requireAuth, async (req, res) => {
  try {
    const { asset, to, amount, memo, confirmed, idempotencyKey } = req.body;
    const result = await rails.sendPayment({
      agentId: req.agentId,
      asset: String(asset).toUpperCase(),
      to,
      amount,
      memo,
      confirmed: !!confirmed,
      idempotencyKey,
    });
    res.json(result);
  } catch (err) {
    if (err.code === 'CONFIRMATION_REQUIRED') {
      return res.status(202).json({ error: err.message, code: err.code });
    }
    res.status(400).json({ error: err.message });
  }
});

// --- Admin routes (unscoped, for internal dashboard use only) ----------
const ledger = require('../core/ledger');
const depositVerifier = require('../core/depositVerifier');
const balances = require('../core/balances');

app.get('/v1/admin/ledger', requireAdminAuth, (req, res) => {
  const { agentId, since } = req.query;
  const payments = ledger.listPayments({ agentId, since });
  res.json({ count: payments.length, payments });
});

app.get('/v1/admin/invoices', requireAdminAuth, (req, res) => {
  const { agentId, since, status } = req.query;
  const invoices = ledger.listInvoices({ agentId, since, status });
  res.json({ count: invoices.length, invoices });
});

app.get('/v1/admin/policy', requireAdminAuth, (req, res) => {
  const cfg = limits.loadPolicy();
  // Never leak secrets: strip apiKeys/adminApiKeys before returning.
  const { apiKeys, adminApiKeys, ...safeConfig } = cfg;
  res.json(safeConfig);
});

// --- Custodial deposit routes -------------------------------------------
app.post('/v1/deposit/claim', requireAuth, async (req, res) => {
  try {
    const { txHash } = req.body;
    const result = await depositVerifier.verifyAndCreditDeposit({ agentId: req.agentId, txHash });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/v1/deposit/address', requireAuth, (req, res) => {
  res.json({ depositAddress: depositVerifier.depositWalletAddress(), asset: 'USDC' });
});

app.get('/v1/balance-custodial', requireAuth, (req, res) => {
  res.json({ agentId: req.agentId, balanceUsdc: balances.getBalance(req.agentId) });
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`agentic-pay REST API listening on http://localhost:${PORT}`);
});
