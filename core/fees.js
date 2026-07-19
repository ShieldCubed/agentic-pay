'use strict';
/**
 * fees.js
 *
 * Computes the total USDC cost to charge a developer's custodial balance
 * for a send: 1% of the USD value being sent, plus the network fee
 * (converted to USD). Both are debited from the developer's balance;
 * the recipient still gets the full requested `amount`. The gap between
 * what's debited and what's actually spent on-chain is Aumnium's revenue.
 *
 * Gas estimation:
 *   - ETH, USDT, USDC (eth.js adapter): estimated live from the connected
 *     RPC's current gas price. ERC-20 transfers cost more gas than a
 *     native ETH send, so USDT/USDC use a higher gas limit estimate.
 *   - BTC, XRP, XMR, ZEC: live per-rail estimation isn't wired up yet.
 *     Falls back to config.json -> networkFeeEstimatesUsd, or a
 *     conservative default. Replace with live estimation per rail as
 *     each one goes to production.
 */

const { ethers } = require('ethers');
const priceFeed = require('./priceFeed');

const PERCENTAGE_FEE_RATE = 0.01; // 1%

const ETH_GAS_LIMITS = {
  ETH: 21000n,
  USDT: 65000n,
  USDC: 65000n,
};

async function estimateEvmGasFeeUsd(asset, policy) {
  const rpcUrl = process.env.ETH_RPC_URL;
  if (!rpcUrl) return null;

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || feeData.maxFeePerGas;
    if (!gasPrice) return null;

    const gasLimit = ETH_GAS_LIMITS[asset] || ETH_GAS_LIMITS.ETH;
    const gasCostWei = gasPrice * gasLimit;
    const gasCostEth = Number(ethers.formatEther(gasCostWei));

    const ethPriceUsd = (await priceFeed.getPrice('ETH', policy)) ?? (policy.staticPricesUsd || {}).ETH;
    if (!ethPriceUsd) return null;

    return gasCostEth * ethPriceUsd;
  } catch (err) {
    console.warn(`Gas estimation failed for ${asset}, falling back to configured estimate: ${err.message}`);
    return null;
  }
}

/**
 * Returns { percentageFeeUsd, networkFeeUsd, totalFeeUsd }, all denominated
 * in USD (treated 1:1 with USDC). `usdEquivalent` is the USD value of the
 * amount being sent (already computed by railManager via priceUsd()).
 */
async function computeFee({ asset, usdEquivalent, policy }) {
  const percentageFeeUsd = usdEquivalent * PERCENTAGE_FEE_RATE;

  let networkFeeUsd = null;
  if (['ETH', 'USDT', 'USDC'].includes(asset)) {
    networkFeeUsd = await estimateEvmGasFeeUsd(asset, policy);
  }
  if (networkFeeUsd == null) {
    const fallback = (policy.networkFeeEstimatesUsd || {})[asset];
    networkFeeUsd = fallback != null ? fallback : 0.5; // conservative last-resort default
  }

  return {
    percentageFeeUsd,
    networkFeeUsd,
    totalFeeUsd: percentageFeeUsd + networkFeeUsd,
  };
}

module.exports = { computeFee, PERCENTAGE_FEE_RATE };
