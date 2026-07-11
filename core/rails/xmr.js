'use strict';
/**
 * rails/xmr.js
 *
 * Monero rail. This is a thin JSON-RPC client — it does NOT bundle a
 * Monero node or wallet. You must run `monero-wallet-rpc` yourself
 * (official Monero project binary) pointed at a synced node, and this
 * adapter talks to it. See docs/SETUP_LINUX.md / SETUP_WINDOWS.md /
 * SETUP_MACOS.md for exact commands.
 *
 * monero-wallet-rpc defaults to HTTP Digest authentication when started
 * with --rpc-login user:pass, which is strongly recommended for anything
 * beyond local loopback testing. This adapter implements digest auth
 * directly (no extra dependency).
 *
 * Config (see config/.env.example):
 *   XMR_WALLET_RPC_URL     e.g. http://127.0.0.1:18082/json_rpc
 *   XMR_WALLET_RPC_USER    (optional, if --rpc-login is set)
 *   XMR_WALLET_RPC_PASS    (optional, if --rpc-login is set)
 */

const crypto = require('crypto');
const { loadSecret, loadOptional } = require('../keystore');

function md5(input) {
  return crypto.createHash('md5').update(input).digest('hex');
}

function parseDigestHeader(header) {
  const params = {};
  const regex = /(\w+)=("([^"]*)"|[^,]*)/g;
  let match;
  while ((match = regex.exec(header)) !== null) {
    params[match[1]] = match[3] !== undefined ? match[3] : match[2];
  }
  return params;
}

async function digestRpcCall(method, params = {}) {
  const url = loadSecret('XMR_WALLET_RPC_URL');
  const user = loadOptional('XMR_WALLET_RPC_USER');
  const pass = loadOptional('XMR_WALLET_RPC_PASS');
  const body = JSON.stringify({ jsonrpc: '2.0', id: '0', method, params });

  let res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (res.status === 401 && user && pass) {
    const authHeader = res.headers.get('www-authenticate');
    const digest = parseDigestHeader(authHeader);
    const nc = '00000001';
    const cnonce = crypto.randomBytes(8).toString('hex');
    const ha1 = md5(`${user}:${digest.realm}:${pass}`);
    const ha2 = md5(`POST:/json_rpc`);
    const response = md5(
      `${ha1}:${digest.nonce}:${nc}:${cnonce}:${digest.qop || 'auth'}:${ha2}`
    );
    const authValue =
      `Digest username="${user}", realm="${digest.realm}", ` +
      `nonce="${digest.nonce}", uri="/json_rpc", qop=${digest.qop || 'auth'}, ` +
      `nc=${nc}, cnonce="${cnonce}", response="${response}", ` +
      `algorithm=MD5${digest.opaque ? `, opaque="${digest.opaque}"` : ''}`;

    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authValue },
      body,
    });
  }

  if (!res.ok) throw new Error(`monero-wallet-rpc error: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (json.error) throw new Error(`monero-wallet-rpc RPC error: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function getAddress() {
  const result = await digestRpcCall('get_address', { account_index: 0 });
  return result.address;
}

async function getBalance() {
  const result = await digestRpcCall('get_balance', { account_index: 0 });
  return {
    asset: 'XMR',
    amount: result.unlocked_balance / 1e12,
    totalBalance: result.balance / 1e12,
    unit: 'piconero (converted to XMR)',
  };
}

async function send({ to, amount, priority = 1 }) {
  const atomicAmount = Math.round(amount * 1e12);
  const result = await digestRpcCall('transfer', {
    destinations: [{ amount: atomicAmount, address: to }],
    account_index: 0,
    priority, // 0=default,1=unimportant,2=normal,3=elevated,4=priority
    get_tx_key: true,
  });
  return { asset: 'XMR', txId: result.tx_hash, txKey: result.tx_key, to, amount };
}

async function getTransaction(txid) {
  return digestRpcCall('get_transfer_by_txid', { txid });
}

module.exports = { asset: 'XMR', getAddress, getBalance, send, getTransaction };
