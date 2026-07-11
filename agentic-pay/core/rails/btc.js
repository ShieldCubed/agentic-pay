'use strict';
/**
 * rails/btc.js
 *
 * Bitcoin rail. Uses bitcoinjs-lib for transaction construction/signing and
 * an Esplora-compatible REST API (blockstream.info, mempool.space, or your
 * own self-hosted Esplora instance) for UTXO lookups and broadcast.
 *
 * Config (see config/.env.example):
 *   BTC_NETWORK        "mainnet" | "testnet"
 *   BTC_WIF             WIF-encoded private key (funding key)
 *   BTC_ESPLORA_URL      e.g. https://blockstream.info/api
 */

const bitcoin = require('bitcoinjs-lib');
const { ECPairFactory } = require('ecpair');
const ecc = require('tiny-secp256k1');
const { loadSecret, loadOptional } = require('../keystore');

const ECPair = ECPairFactory(ecc);

function network() {
  const net = loadOptional('BTC_NETWORK', 'testnet');
  return net === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
}

function esploraUrl() {
  return loadOptional(
    'BTC_ESPLORA_URL',
    network() === bitcoin.networks.bitcoin
      ? 'https://blockstream.info/api'
      : 'https://blockstream.info/testnet/api'
  );
}

async function esploraFetch(pathSuffix, opts) {
  const res = await fetch(`${esploraUrl()}${pathSuffix}`, opts);
  if (!res.ok) throw new Error(`Esplora request failed: ${res.status} ${await res.text()}`);
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

function keyPair() {
  return ECPair.fromWIF(loadSecret('BTC_WIF'), network());
}

function getAddress() {
  const kp = keyPair();
  const { address } = bitcoin.payments.p2wpkh({ pubkey: kp.publicKey, network: network() });
  return address;
}

async function getBalance() {
  const address = getAddress();
  const stats = await esploraFetch(`/address/${address}`);
  const sats =
    stats.chain_stats.funded_txo_sum -
    stats.chain_stats.spent_txo_sum +
    stats.mempool_stats.funded_txo_sum -
    stats.mempool_stats.spent_txo_sum;
  return { asset: 'BTC', amount: sats / 1e8, raw: sats, unit: 'sats' };
}

async function send({ to, amount, feeRateSatsPerVb = 10 }) {
  const address = getAddress();
  const kp = keyPair();
  const utxos = await esploraFetch(`/address/${address}/utxo`);
  if (!utxos.length) throw new Error('No UTXOs available to spend.');

  const targetSats = Math.round(amount * 1e8);
  const psbt = new bitcoin.Psbt({ network: network() });

  let inputSats = 0;
  const usedUtxos = [];
  for (const utxo of utxos) {
    const txHex = await esploraFetch(`/tx/${utxo.txid}/hex`);
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      nonWitnessUtxo: Buffer.from(txHex, 'hex'),
    });
    inputSats += utxo.value;
    usedUtxos.push(utxo);
    // rough size estimate: enough inputs to cover target + generous fee buffer
    const estFeeSats = feeRateSatsPerVb * (usedUtxos.length * 148 + 2 * 34 + 10);
    if (inputSats >= targetSats + estFeeSats) break;
  }

  const estFeeSats = feeRateSatsPerVb * (usedUtxos.length * 148 + 2 * 34 + 10);
  if (inputSats < targetSats + estFeeSats) {
    throw new Error('Insufficient confirmed balance to cover amount + fee.');
  }

  psbt.addOutput({ address: to, value: targetSats });
  const change = inputSats - targetSats - estFeeSats;
  if (change > 546) {
    // avoid dust outputs
    psbt.addOutput({ address, value: change });
  }

  usedUtxos.forEach((_, i) => psbt.signInput(i, kp));
  psbt.finalizeAllInputs();
  const txHex = psbt.extractTransaction().toHex();

  const txid = await esploraFetch('/tx', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: txHex,
  });

  return { asset: 'BTC', txId: txid.trim(), to, amount };
}

async function getTransaction(txid) {
  return esploraFetch(`/tx/${txid}`);
}

module.exports = { asset: 'BTC', getAddress, getBalance, send, getTransaction };
