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
const alerts = require('./alerts');

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
 * Returns { orgId, name, agentIds, orgDailyCapUsd } for the org that
 * `agentId` belongs to, or null if the agent isn't part of any org.
 * Orgs are configured in config.json under "orgs" -> orgId -> { agentIds, ... }.
 */
function orgFor(agentId) {
  const cfg = loadPolicy();
  const orgs = cfg.orgs || {};
  for (const [orgId, org] of Object.entries(orgs)) {
    if ((org.agentIds || []).includes(agentId)) {
      return { orgId, ...org };
    }
  }
  return null;
}

/**
 * Rolling 24h USD spend summed across every agent belonging to orgId.
 * This is independent of, and additive to, each agent's own per-agent cap.
 */
function orgDailySpendUsd(orgId) {
  const cfg = loadPolicy();
  const org = (cfg.orgs || {})[orgId];
  if (!org) return 0;
  return (org.agentIds || []).reduce((sum, agentId) => sum + dailySpendUsd(agentId), 0);
}

/**
 * Throws if the requested send violates policy. Returns
 * { requiresConfirmation: boolean } if it's within policy.
 */
function checkSend({ agentId, asset, usdEquivalent, toAddress, confirmed }) {
  const cfg = loadPolicy();
  const policy = policyFor(agentId);
  const alertsCfg = cfg.alerts;

  const violate = (message) => {
    alerts.notify('policy_violation', { agentId, asset, usdEquivalent, toAddress, message }, alertsCfg).catch(() => {});
    throw new Error(message);
  };

  if (policy.allowedAssets && !policy.allowedAssets.includes(asset)) {
    violate(`Policy violation: agent "${agentId}" is not permitted to send ${asset}.`);
  }

  if (policy.allowlistAddresses && !policy.allowlistAddresses.includes(toAddress)) {
    violate(`Policy violation: destination address is not on agent "${agentId}"'s allowlist.`);
  }

  if (usdEquivalent > policy.perTxCapUsd) {
    violate(
      `Policy violation: ${usdEquivalent} USD exceeds per-transaction cap of ` +
      `${policy.perTxCapUsd} USD for agent "${agentId}".`
    );
  }

  const spentToday = dailySpendUsd(agentId);
  if (spentToday + usdEquivalent > policy.dailyCapUsd) {
    violate(
      `Policy violation: this send would bring agent "${agentId}"'s rolling ` +
      `24h total to ${(spentToday + usdEquivalent).toFixed(2)} USD, exceeding ` +
      `the daily cap of ${policy.dailyCapUsd} USD.`
    );
  }

  const org = orgFor(agentId);
  if (org && org.orgDailyCapUsd != null) {
    const orgSpentToday = orgDailySpendUsd(org.orgId);
    if (orgSpentToday + usdEquivalent > org.orgDailyCapUsd) {
      violate(
        `Policy violation: this send would bring org "${org.orgId}"'s rolling ` +
        `24h total to ${(orgSpentToday + usdEquivalent).toFixed(2)} USD, exceeding ` +
        `the org daily cap of ${org.orgDailyCapUsd} USD.`
      );
    }
  }

  const requiresConfirmation = usdEquivalent >= policy.confirmationFloorUsd;
  if (requiresConfirmation && !confirmed) {
    alerts.notify('confirmation_required', { agentId, asset, usdEquivalent, toAddress }, alertsCfg).catch(() => {});
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

module.exports = { policyFor, dailySpendUsd, orgFor, orgDailySpendUsd, checkSend, loadPolicy };
