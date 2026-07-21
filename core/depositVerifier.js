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
const DEFAULT_USDT_MAINNET = '0xdAC17F958D2ee523a2206206994597C13D831ec';

const MIN_CONFIRMATIONS = 2;

function provider() {
  return new ethers.JsonRpcProvider(loadSecret('ETH_RPC_URL'));
}

function usdcAddress() {
  return loadOptional('USDC_CONTRACT_ADDRESS', DEFAULT_USDC_MAINNET);
}

function usdtAddress() {
  return loadOptional('USDT_CONTRACT_ADDRESS', DEFAULT_USDT_MAINNET);
}

/**
 * Returns [{ symbol, address }] for every stablecoin this deposit flow
 * accepts. Both are treated as ~1:1 USD for custodial balance purposes,
 * matching staticPricesUsd in config.json (USDT: 1, USDC: 1).
 */
function acceptedTokens() {
  return [
    { symbol: 'USDC', address: usdcAddress() },
    { symbol: 'USDT', address: usdtAddress() },
  ];
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

  const tokens = acceptedTokens();
  const depositTarget = depositWalletAddress();
  const iface = new ethers.Interface(ERC20_TRANSFER_ABI);

  let matchedAmount = null;
  let matchedSymbol = null;
  for (const log of receipt.logs) {
    const token = tokens.find((t) => t.address.toLowerCase() === log.address.toLowerCase());
    if (!token) continue;
    let parsed;
    try {
      parsed = iface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed.name !== 'Transfer') continue;
    if (parsed.args.to.toLowerCase() !== depositTarget.toLowerCase()) continue;

    matchedAmount = parsed.args.value;
    matchedSymbol = token.symbol;
    break;
  }

  if (matchedAmount === null) {
    const symbols = tokens.map((t) => t.symbol).join('/');
    throw new Error(
      `Transaction ${txHash} does not contain a ${symbols} transfer to the ` +
      `deposit address (${depositTarget}). Wrong token, wrong recipient, ` +
      `or wrong transaction.`
    );
  }

  const amountUsdc = Number(ethers.formatUnits(matchedAmount, 6));

  const result = balances.creditDeposit({ agentId, amountUsdc, depositTxId: txHash, asset: matchedSymbol });
  return { ...result, amountUsdc, asset: matchedSymbol, depositAddress: depositTarget };
}

module.exports = { verifyAndCreditDeposit, depositWalletAddress };
