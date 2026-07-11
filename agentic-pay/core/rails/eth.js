'use strict';
/**
 * rails/eth.js
 *
 * Ethereum rail. Handles native ETH transfers and ERC-20 transfers, which
 * is how this one file also serves USDT and USDC (both are ERC-20 tokens
 * on Ethereum mainnet). Point ETH_RPC_URL at any EVM JSON-RPC endpoint —
 * your own node, Infura, Alchemy, etc.
 *
 * Config (see config/.env.example):
 *   ETH_RPC_URL          e.g. https://mainnet.infura.io/v3/<key>, or a
 *                         Sepolia/testnet endpoint for testing
 *   ETH_PRIVATE_KEY       0x-prefixed private key of the funding wallet
 *   USDT_CONTRACT_ADDRESS (defaults to mainnet USDT if unset)
 *   USDC_CONTRACT_ADDRESS (defaults to mainnet USDC if unset)
 *
 * Note: USDT/USDC also exist on other chains (Tron/TRC-20, Solana, etc.).
 * This adapter covers the ERC-20 (Ethereum) versions. To support another
 * chain's USDT/USDC, add a sibling adapter (e.g. rails/usdt_trc20.js) and
 * register it in railManager.js under a distinct asset key.
 */

const { ethers } = require('ethers');
const { loadSecret, loadOptional } = require('../keystore');

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

const DEFAULT_TOKENS = {
  USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec',
  USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
};

function provider() {
  return new ethers.JsonRpcProvider(loadSecret('ETH_RPC_URL'));
}

function wallet() {
  return new ethers.Wallet(loadSecret('ETH_PRIVATE_KEY'), provider());
}

function tokenAddress(symbol) {
  const envKey = `${symbol}_CONTRACT_ADDRESS`;
  return loadOptional(envKey, DEFAULT_TOKENS[symbol]);
}

function getAddress() {
  return new ethers.Wallet(loadSecret('ETH_PRIVATE_KEY')).address;
}

async function getBalance(asset = 'ETH') {
  const address = getAddress();
  if (asset === 'ETH') {
    const bal = await provider().getBalance(address);
    return { asset: 'ETH', amount: Number(ethers.formatEther(bal)), raw: bal.toString() };
  }
  const contract = new ethers.Contract(tokenAddress(asset), ERC20_ABI, provider());
  const [raw, decimals] = await Promise.all([
    contract.balanceOf(address),
    contract.decimals(),
  ]);
  return {
    asset,
    amount: Number(ethers.formatUnits(raw, decimals)),
    raw: raw.toString(),
  };
}

async function send({ to, amount, asset = 'ETH' }) {
  const signer = wallet();

  if (asset === 'ETH') {
    const tx = await signer.sendTransaction({ to, value: ethers.parseEther(String(amount)) });
    const receipt = await tx.wait();
    return { asset: 'ETH', txId: receipt.hash, to, amount };
  }

  const contract = new ethers.Contract(tokenAddress(asset), ERC20_ABI, signer);
  const decimals = await contract.decimals();
  const value = ethers.parseUnits(String(amount), decimals);
  const tx = await contract.transfer(to, value);
  const receipt = await tx.wait();
  return { asset, txId: receipt.hash, to, amount };
}

async function getTransaction(txHash) {
  return provider().getTransactionReceipt(txHash);
}

module.exports = {
  asset: ['ETH', 'USDT', 'USDC'],
  getAddress,
  getBalance,
  send,
  getTransaction,
};
