'use strict';
/**
 * ledger.js
 *
 * A minimal, dependency-free append-only local ledger. Records every
 * invoice created and every payment sent, keyed by an idempotency key,
 * so that a retried agent tool-call never double-spends.
 *
 * Storage is a single JSON file. This is intentionally simple and fully
 * portable (no native modules) across Linux/Windows/macOS/mobile-hosted
 * Node runtimes. For high-volume production use, swap this module for a
 * real database (Postgres, SQLite via better-sqlite3, etc.) behind the
 * same three functions.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.AGENTIC_PAY_DATA_DIR ||
  path.join(require('os').homedir(), '.agentic-pay');
const LEDGER_FILE = path.join(DATA_DIR, 'ledger.json');

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LEDGER_FILE)) {
    fs.writeFileSync(LEDGER_FILE, JSON.stringify({ invoices: {}, payments: {} }, null, 2));
  }
}

function read() {
  ensureStore();
  return JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
}

function write(data) {
  fs.writeFileSync(LEDGER_FILE, JSON.stringify(data, null, 2));
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

function createInvoice({ asset, amount, memo, agentId }) {
  const db = read();
  const id = newId('inv');
  db.invoices[id] = {
    id,
    asset,
    amount,
    memo: memo || null,
    agentId: agentId || null,
    status: 'pending',
    createdAt: new Date().toISOString(),
    paidTxId: null,
  };
  write(db);
  return db.invoices[id];
}

function markInvoicePaid(invoiceId, txId) {
  const db = read();
  if (!db.invoices[invoiceId]) throw new Error(`Unknown invoice ${invoiceId}`);
  db.invoices[invoiceId].status = 'paid';
  db.invoices[invoiceId].paidTxId = txId;
  db.invoices[invoiceId].paidAt = new Date().toISOString();
  write(db);
  return db.invoices[invoiceId];
}

function getInvoice(invoiceId) {
  const db = read();
  return db.invoices[invoiceId] || null;
}

/**
 * Idempotent payment recording. If a payment with the same idempotencyKey
 * already exists, its recorded result is returned instead of re-sending —
 * this is the guard against an agent retrying a tool call and double-paying.
 */
function recordPayment(idempotencyKey, paymentRecord) {
  const db = read();
  if (db.payments[idempotencyKey]) {
    return { existing: true, record: db.payments[idempotencyKey] };
  }
  db.payments[idempotencyKey] = {
    ...paymentRecord,
    idempotencyKey,
    recordedAt: new Date().toISOString(),
  };
  write(db);
  return { existing: false, record: db.payments[idempotencyKey] };
}

function getPayment(idempotencyKey) {
  const db = read();
  return db.payments[idempotencyKey] || null;
}

function listPayments({ agentId, since } = {}) {
  const db = read();
  return Object.values(db.payments).filter((p) => {
    if (agentId && p.agentId !== agentId) return false;
    if (since && new Date(p.recordedAt) < new Date(since)) return false;
    return true;
  });
}

module.exports = {
  createInvoice,
  markInvoicePaid,
  getInvoice,
  recordPayment,
  getPayment,
  listPayments,
};
