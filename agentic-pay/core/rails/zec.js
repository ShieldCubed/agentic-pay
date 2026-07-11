'use strict';
/**
 * rails/zec.js
 *
 * Zcash rail. Thin JSON-RPC client to `zcashd` (or a compatible node
 * exposing the standard Zcash RPC interface). Does not bundle a node —
 * you run zcashd yourself. See docs/SETUP_*.md for exact commands.
 *
 * Supports both transparent (t-addr) and shielded (z-addr, Sapling/Orchard)
 * addresses via z_sendmany, which is the recommended modern send method
 * (the legacy sendtoaddress path is transparent-only and is not used here).
 *
 * Config (see config/.env.example):
 *   ZEC_RPC_URL        e.g. http://127.0.0.1:8232
 *   ZEC_RPC_USER
 *   ZEC_RPC_PASS
 *   ZEC_FROM_ADDRESS   the funding address (transparent or shielded)
 */

const { loadSecret } = require('../keystore');

async function rpcCall(method, params = []) {
  const url = loadSecret('ZEC_RPC_URL');
  const user = loadSecret('ZEC_RPC_USER');
  const pass = loadSecret('ZEC_RPC_PASS');
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'agentic-pay', method, params }),
  });

  if (!res.ok) throw new Error(`zcashd RPC error: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (json.error) throw new Error(`zcashd RPC error: ${JSON.stringify(json.error)}`);
  return json.result;
}

function getAddress() {
  return loadSecret('ZEC_FROM_ADDRESS');
}

async function getBalance() {
  const address = getAddress();
  // z_getbalance works for both transparent and shielded addresses
  const balance = await rpcCall('z_getbalance', [address]);
  return { asset: 'ZEC', amount: balance };
}

async function send({ to, amount, memo }) {
  const from = getAddress();
  const recipient = { address: to, amount };
  // Memos are only honored when the recipient is a shielded (z-) address.
  if (memo && to.startsWith('z')) {
    recipient.memo = Buffer.from(memo, 'utf8').toString('hex');
  }
  const opId = await rpcCall('z_sendmany', [from, [recipient], 1, null, 'AllowRevealedSenders']);

  // z_sendmany is asynchronous — poll the operation status.
  let status;
  for (let i = 0; i < 60; i++) {
    const [opStatus] = await rpcCall('z_getoperationstatus', [[opId]]);
    status = opStatus;
    if (status.status === 'success' || status.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (!status || status.status !== 'success') {
    throw new Error(`Zcash send did not complete: ${JSON.stringify(status)}`);
  }

  return { asset: 'ZEC', txId: status.result.txid, to, amount, opId };
}

async function getTransaction(txid) {
  return rpcCall('gettransaction', [txid]);
}

module.exports = { asset: 'ZEC', getAddress, getBalance, send, getTransaction };
