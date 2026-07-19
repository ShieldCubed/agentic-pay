'use strict';
/**
 * priceFeed.js
 *
 * Live USD price lookup with in-memory caching, used by railManager.priceUsd()
 * for spend-limit calculations. Falls back to config.json's staticPricesUsd
 * (in railManager.js) if the live feed is disabled, unconfigured, or fails.
 *
 * Provider: CoinGecko public API (no key required for this endpoint, subject
 * to CoinGecko's public rate limits). Swap ASSET_TO_COINGECKO_ID / the fetch
 * call to point at a different provider if you hit rate limits or want a
 * paid feed.
 */

const ASSET_TO_COINGECKO_ID = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  USDT: 'tether',
  USDC: 'usd-coin',
  XRP: 'ripple',
  XMR: 'monero',
  ZEC: 'zcash',
};

const cache = new Map(); // asset -> { price, fetchedAt }

async function fetchLivePrice(asset) {
  const id = ASSET_TO_COINGECKO_ID[asset];
  if (!id) return null;

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko request failed: ${res.status}`);
  const json = await res.json();
  const price = json[id]?.usd;
  if (typeof price !== 'number') throw new Error(`CoinGecko response missing price for ${asset}`);
  return price;
}

/**
 * Returns a live USD price for `asset`, using an in-memory cache (TTL from
 * policy.priceFeed.cacheTtlSeconds, default 60s) to avoid hammering the
 * provider on every tool-call. Returns null (never throws) if the feed is
 * explicitly disabled in config — caller should fall back to
 * staticPricesUsd. Throws only on an actual fetch/parse failure, so the
 * caller can tell "intentionally disabled" apart from "broken right now."
 */
async function getPrice(asset, policy) {
  const feedCfg = policy.priceFeed || {};
  if (feedCfg.enabled === false) return null;

  const ttlMs = (feedCfg.cacheTtlSeconds ?? 60) * 1000;
  const cached = cache.get(asset);
  if (cached && Date.now() - cached.fetchedAt < ttlMs) {
    return cached.price;
  }

  const price = await fetchLivePrice(asset);
  if (price === null) return null;

  cache.set(asset, { price, fetchedAt: Date.now() });
  return price;
}

module.exports = { getPrice };
