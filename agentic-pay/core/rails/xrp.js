'use strict';
/**
 * rails/xrp.js
 *
 * XRP Ledger rail, using xrpl.js. Connects to a public or self-hosted
 * XRPL WebSocket node.
 *
 * Config (see config/.env.example):
 *   XRP_WSS_URL       e.g. wss://xrplcluster.com (mainnet) or
 *                     wss://s.altnet.rippletest.net:51233 (testnet)
 *   XRP_SEED          the funding wallet's family seed (starts with "s")
 */

const xrpl = require('xrpl');
const { loadSecret } = require('../keystore');

async function withClient(fn) {
  const client = new xrpl.Client(loadSecret('XRP_WSS_URL'));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.disconnect();
  }
}

function getAddress() {
  const wallet = xrpl.Wallet.fromSeed(loadSecret('XRP_SEED'));
  return wallet.address;
}

async function getBalance() {
  const address = getAddress();
  return withClient(async (client) => {
    const balances = await client.getXrpBalance(address);
    return { asset: 'XRP', amount: Number(balances) };
  });
}

async function send({ to, amount, memo }) {
  const wallet = xrpl.Wallet.fromSeed(loadSecret('XRP_SEED'));
  return withClient(async (client) => {
    const tx = {
      TransactionType: 'Payment',
      Account: wallet.address,
      Destination: to,
      Amount: xrpl.xrpToDrops(String(amount)),
    };
    if (memo) {
      tx.Memos = [
        {
          Memo: { MemoData: Buffer.from(memo, 'utf8').toString('hex').toUpperCase() },
        },
      ];
    }
    const prepared = await client.autofill(tx);
    const signed = wallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);
    return {
      asset: 'XRP',
      txId: result.result.hash,
      to,
      amount,
      engineResult: result.result.meta.TransactionResult,
    };
  });
}

async function getTransaction(txHash) {
  return withClient((client) => client.request({ command: 'tx', transaction: txHash }));
}

module.exports = { asset: 'XRP', getAddress, getBalance, send, getTransaction };
