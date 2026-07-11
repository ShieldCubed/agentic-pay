'use strict';
/**
 * limits.js
 *
 * Safety layer sitting between agent tool-calls and actual on-chain sends.
 * This is the single most important file in the project: it is what stops
 * a buggy prompt, a compromised agent, or a hallucinated tool-call from
 * draining a wallet.
 *
 * Policy is configured in config/config.json (see config/config.example.json)
 * and can be overridden per-agent via AGENT_POLICIES.
 *
 * Three independent guards:
 *   1. Per-transaction cap      -> hard reject above this, no exceptions
 *   2. Rolling daily cap        -> hard reject once the agent's 24h total
 *                                  (in USD-equivalent, roughly) is exceeded
 *   3. Human-confirmation floor -> below the per-tx cap but above this,
 *                                  require an explicit `confirmed: true`
 *                                  flag passed by a human-reviewed step
 *                                  before the send executes
 */

const fs = require('fs');
const path = require('path');
const ledger = require('./ledger');

const CONFIG_PATH = process.env.AGENTIC_PAY_CONFIG ||
  path.join(__dirname, '..', 'config', 'config.json');

function loadPolicy() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `No config found at ${CONFIG_PATH}. Copy config/config.example.json ` +
      `to config/config.json and set your limits before sending any funds.`
    );
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function policyFor(agentId) {
  const cfg = loadPolicy();
  const agentOverride = (cfg.agentPolicies || {})[agentId];
  return {
    perTxCapUsd: agentOverride?.perTxCapUsd ?? cfg.defaultPolicy.perTxCapUsd,
    dailyCapUsd: agentOverride?.dailyCapUsd ?? cfg.defaultPolicy.dailyCapUsd,
    confirmationFloorUsd:
      agentOverride?.confirmationFloorUsd ?? cfg.defaultPolicy.confirmationFloorUsd,
    allowedAssets: agentOverride?.allowedAssets ?? cfg.defaultPolicy.allowedAssets,
    allowlistAddresses: agentOverride?.allowlistAddresses ?? null,
  };
}

function dailySpendUsd(agentId) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const payments = ledger.listPayments({ agentId, since });
  return payments.reduce((sum, p) => sum + (p.usdEquivalent || 0), 0);
}

/**
 * Throws if the requested send violates policy. Returns
 * { requiresConfirmation: boolean } if it's within policy.
 */
function checkSend({ agentId, asset, usdEquivalent, toAddress, confirmed }) {
  const policy = policyFor(agentId);

  if (policy.allowedAssets && !policy.allowedAssets.includes(asset)) {
    throw new Error(`Policy violation: agent "${agentId}" is not permitted to send ${asset}.`);
  }

  if (policy.allowlistAddresses && !policy.allowlistAddresses.includes(toAddress)) {
    throw new Error(
      `Policy violation: destination address is not on agent "${agentId}"'s allowlist.`
    );
  }

  if (usdEquivalent > policy.perTxCapUsd) {
    throw new Error(
      `Policy violation: ${usdEquivalent} USD exceeds per-transaction cap of ` +
      `${policy.perTxCapUsd} USD for agent "${agentId}".`
    );
  }

  const spentToday = dailySpendUsd(agentId);
  if (spentToday + usdEquivalent > policy.dailyCapUsd) {
    throw new Error(
      `Policy violation: this send would bring agent "${agentId}"'s rolling ` +
      `24h total to ${(spentToday + usdEquivalent).toFixed(2)} USD, exceeding ` +
      `the daily cap of ${policy.dailyCapUsd} USD.`
    );
  }

  const requiresConfirmation = usdEquivalent >= policy.confirmationFloorUsd;
  if (requiresConfirmation && !confirmed) {
    const err = new Error(
      `This payment of ~${usdEquivalent} USD requires explicit human confirmation ` +
      `(pass confirmed: true after human review) because it is at or above the ` +
      `confirmation floor of ${policy.confirmationFloorUsd} USD for agent "${agentId}".`
    );
    err.code = 'CONFIRMATION_REQUIRED';
    throw err;
  }

  return { requiresConfirmation };
}

module.exports = { policyFor, dailySpendUsd, checkSend, loadPolicy };
