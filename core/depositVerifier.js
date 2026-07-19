'use strict';
/**
 * depositVerifier.js
 *
 * Verifies a developer-submitted USDC deposit transaction on-chain before
 * crediting their custodial balance. Flow: developer sends USDC to
 * Aumnium's receiving wallet, then calls POST /v1/deposit/claim with the
 * tx hash. This module confirms the transaction actually happened, sent
 * the right token, to the right address, before balances.creditDeposit()
 * is ever called. Idempotency (same tx claimed twice) is handled by
 * balances.js itself, keyed on the tx hash.
 */

const { ethers } = require('ethers');
const { loadSecret, loadOptional } = require('./keystore');
const balances = require('./balances');

const ERC20_TRANSFER_ABI = ['event Transfer(address indexed from, address indexed to, uint256 value)'];
const DEFAULT_USDC_MAINNET = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

const MIN_CONFIRMATIONS = 2;

function provider() {
  return new ethers.JsonRpcProvider(loadSecret('ETH_RPC_URL'));
}

function usdcAddress() {
  return loadOptional('USDC_CONTRACT_ADDRESS', DEFAULT_USDC_MAINNET);
}

function depositWalletAddress() {
  return new ethers.Wallet(loadSecret('ETH_PRIVATE_KEY')).address;
}

async function verifyAndCreditDeposit({ agentId, txHash }) {
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new Error('Invalid txHash format.');
  }

  const p = provider();
  const receipt = await p.getTransactionReceipt(txHash);
  if (!receipt) {
    throw new Error(`Transaction ${txHash} not found (not yet mined, or wrong network).`);
  }
  if (receipt.status !== 1) {
    throw new Error(`Transaction ${txHash} failed on-chain (status !== success).`);
  }

  const currentBlock = await p.getBlockNumber();
  const confirmations = currentBlock - receipt.blockNumber + 1;
  if (confirmations < MIN_CONFIRMATIONS) {
    throw new Error(
      `Transaction ${txHash} only has ${confirmations} confirmation(s); ` +
      `need at least ${MIN_CONFIRMATIONS}. Try again shortly.`
    );
  }

  const usdc = usdcAddress();
  const depositTarget = depositWalletAddress();
  const iface = new ethers.Interface(ERC20_TRANSFER_ABI);

  let matchedAmount = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== usdc.toLowerCase()) continue;
    let parsed;
    try {
      parsed = iface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed.name !== 'Transfer') continue;
    if (parsed.args.to.toLowerCase() !== depositTarget.toLowerCase()) continue;

    matchedAmount = parsed.args.value;
    break;
  }

  if (matchedAmount === null) {
    throw new Error(
      `Transaction ${txHash} does not contain a USDC transfer to the ` +
      `deposit address (${depositTarget}). Wrong token, wrong recipient, ` +
      `or wrong transaction.`
    );
  }

  const amountUsdc = Number(ethers.formatUnits(matchedAmount, 6));

  const result = balances.creditDeposit({ agentId, amountUsdc, depositTxId: txHash });
  return { ...result, amountUsdc, depositAddress: depositTarget };
}

module.exports = { verifyAndCreditDeposit, depositWalletAddress };
