'use strict';
/**
 * railManager.js
 *
 * Single entry point used by both the REST API and the MCP server. Maps
 * an asset symbol to its rail adapter, and wraps every send() call with
 * the policy engine (limits.js) and the idempotent ledger (ledger.js).
 */

const btc = require('./rails/btc');
const eth = require('./rails/eth');
const xrp = require('./rails/xrp');
const xmr = require('./rails/xmr');
const zec = require('./rails/zec');
const limits = require('./limits');
const ledger = require('./ledger');

// Map each supported asset symbol to its adapter and how to call it.
const RAIL_MAP = {
  BTC: { adapter: btc, ethLike: false },
  ETH: { adapter: eth, ethLike: true },
  USDT: { adapter: eth, ethLike: true },
  USDC: { adapter: eth, ethLike: true },
  XRP: { adapter: xrp, ethLike: false },
  XMR: { adapter: xmr, ethLike: false },
  ZEC: { adapter: zec, ethLike: false },
};

const SUPPORTED_ASSETS = Object.keys(RAIL_MAP);

function assertSupported(asset) {
  if (!RAIL_MAP[asset]) {
    throw new Error(
      `Unsupported asset "${asset}". Supported: ${SUPPORTED_ASSETS.join(', ')}`
    );
  }
}

async function getAddress(asset) {
  assertSupported(asset);
  const { adapter, ethLike } = RAIL_MAP[asset];
  return ethLike ? adapter.getAddress() : adapter.getAddress();
}

async function getBalance(asset) {
  assertSupported(asset);
  const { adapter, ethLike } = RAIL_MAP[asset];
  return ethLike ? adapter.getBalance(asset) : adapter.getBalance();
}

/**
 * Pluggable USD price oracle. Defaults to a static config-file fallback
 * (config.json -> staticPricesUsd) so the system works fully offline for
 * testing. Swap `priceUsd()` for a live price feed call in production —
 * this repo intentionally does not hardcode a third-party price API since
 * that choice (and its rate limits/costs) is yours to make.
 */
async function priceUsd(asset) {
  const policy = limits.loadPolicy();
  const staticPrice = (policy.staticPricesUsd || {})[asset];
  if (staticPrice === undefined) {
    throw new Error(
      `No USD price configured for ${asset}. Add it to config.json under ` +
      `staticPricesUsd, or wire in a live price feed in railManager.priceUsd().`
    );
  }
  return staticPrice;
}

/**
 * The single function every agent-facing surface (REST + MCP) should call
 * to move funds. Enforces idempotency and spend policy before ever
 * touching a rail adapter.
 */
async function sendPayment({
  agentId,
  asset,
  to,
  amount,
  memo,
  confirmed = false,
  idempotencyKey,
}) {
  assertSupported(asset);
  if (!idempotencyKey) {
    throw new Error('idempotencyKey is required for every send (prevents duplicate payments).');
  }

  const existing = ledger.getPayment(idempotencyKey);
  if (existing) {
    return { idempotent: true, ...existing };
  }

  const price = await priceUsd(asset);
  const usdEquivalent = price * Number(amount);

  const { requiresConfirmation } = limits.checkSend({
    agentId,
    asset,
    usdEquivalent,
    toAddress: to,
    confirmed,
  });

  const { adapter, ethLike } = RAIL_MAP[asset];
  const result = ethLike
    ? await adapter.send({ to, amount, asset, memo })
    : await adapter.send({ to, amount, memo });

  const { record } = ledger.recordPayment(idempotencyKey, {
    agentId,
    asset,
    to,
    amount,
    usdEquivalent,
    txId: result.txId,
    requiredConfirmation: requiresConfirmation,
  });

  return { idempotent: false, ...record };
}

async function createInvoice({ asset, amount, memo, agentId }) {
  assertSupported(asset);
  const address = await getAddress(asset);
  const invoice = ledger.createInvoice({ asset, amount, memo, agentId });
  return { ...invoice, payToAddress: address };
}

module.exports = {
  SUPPORTED_ASSETS,
  getAddress,
  getBalance,
  sendPayment,
  createInvoice,
  priceUsd,
};
