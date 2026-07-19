'use strict';
/**
 * balances.js
 *
 * Custodial USDC balance ledger for the hosted, deposit-funded model.
 * Each agentId has a balance, credited by confirmed on-chain deposits and
 * debited when they spend via sendPayment(). This is separate from
 * ledger.js's payment/invoice history — this module is specifically the
 * "how much can this agent still spend" number.
 *
 * Storage: same local JSON pattern as ledger.js, single file, no native deps.
 * Swap for a real DB (Postgres etc.) behind these same functions at scale —
 * a JSON file with concurrent writes is not safe for high transaction volume.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.AGENTIC_PAY_DATA_DIR ||
  path.join(require('os').homedir(), '.agentic-pay');
const BALANCES_FILE = path.join(DATA_DIR, 'balances.json');

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BALANCES_FILE)) {
    fs.writeFileSync(BALANCES_FILE, JSON.stringify({ balances: {}, deposits: {} }, null, 2));
  }
}

function read() {
  ensureStore();
  return JSON.parse(fs.readFileSync(BALANCES_FILE, 'utf8'));
}

function write(data) {
  fs.writeFileSync(BALANCES_FILE, JSON.stringify(data, null, 2));
}

/**
 * Current spendable USDC balance for an agent. Returns 0, not an error,
 * for an agent that's never deposited — a fresh agent simply has $0.
 */
function getBalance(agentId) {
  const db = read();
  return db.balances[agentId] || 0;
}

/**
 * Credits a confirmed deposit to an agent's balance. `depositTxId` is used
 * for idempotency — the same on-chain deposit can never be credited twice,
 * even if this function is called multiple times for it (e.g. a webhook
 * retry, or polling that sees the same confirmed tx more than once).
 */
function creditDeposit({ agentId, amountUsdc, depositTxId }) {
  if (!depositTxId) throw new Error('depositTxId is required for every credit (prevents duplicate credits).');
  const db = read();

  if (db.deposits[depositTxId]) {
    return { idempotent: true, balance: db.balances[agentId] || 0 };
  }

  db.balances[agentId] = (db.balances[agentId] || 0) + amountUsdc;
  db.deposits[depositTxId] = {
    agentId,
    amountUsdc,
    creditedAt: new Date().toISOString(),
  };
  write(db);
  return { idempotent: false, balance: db.balances[agentId] };
}

/**
 * Debits an agent's balance for a spend (amount + fee together, called
 * as one combined debit by railManager). Throws if the balance is
 * insufficient — caller must check this BEFORE actually moving any funds
 * on-chain, never after.
 */
function debitBalance({ agentId, totalUsdc }) {
  const db = read();
  const current = db.balances[agentId] || 0;

  if (current < totalUsdc) {
    const err = new Error(
      `Insufficient balance: agent "${agentId}" has ${current} USDC, ` +
      `needs ${totalUsdc} USDC. Deposit more before sending.`
    );
    err.code = 'INSUFFICIENT_BALANCE';
    throw err;
  }

  db.balances[agentId] = current - totalUsdc;
  write(db);
  return db.balances[agentId];
}

function listDeposits({ agentId } = {}) {
  const db = read();
  return Object.entries(db.deposits)
    .filter(([, d]) => !agentId || d.agentId === agentId)
    .map(([depositTxId, d]) => ({ depositTxId, ...d }));
}

module.exports = { getBalance, creditDeposit, debitBalance, listDeposits };
