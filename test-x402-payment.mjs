import 'dotenv/config';
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';

const PRIVATE_KEY = process.env.ETH_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error('ERROR: ETH_PRIVATE_KEY not set in .env');
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY);
console.log('Paying from address:', account.address);

const client = new x402Client();
registerExactEvmScheme(client, { signer: account });

const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const url = 'http://localhost:8787/v1/balance/BTC';
console.log('Requesting (with automatic 402 payment):', url);

try {
  const response = await fetchWithPayment(url, {
    method: 'GET',
    headers: { 'x-api-key': 'sk-agent-abc123' },
  });

  console.log('Response status:', response.status);
  const data = await response.json();
  console.log('Response body:', JSON.stringify(data, null, 2));
} catch (err) {
  console.error('Payment/request failed:', err.message);
  process.exit(1);
}
