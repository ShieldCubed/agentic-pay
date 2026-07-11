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

// --- Routes ------------------------------------------------------------

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

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`agentic-pay REST API listening on http://localhost:${PORT}`);
});
