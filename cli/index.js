#!/usr/bin/env node
'use strict';
/**
 * cli/index.js
 *
 * Command-line interface to the payment engine. Identical on Linux,
 * Windows, and macOS since it runs on Node directly rather than shelling
 * out to platform tools.
 *
 * Examples:
 *   agentic-pay rails
 *   agentic-pay address BTC
 *   agentic-pay balance ETH
 *   agentic-pay invoice --asset USDC --amount 25 --memo "invoice #42"
 *   agentic-pay send --asset XRP --to rXXXX... --amount 10 \
 *       --idempotency-key my-unique-key-001
 */

const { Command } = require('commander');
const rails = require('../core/railManager');

const program = new Command();
program.name('agentic-pay').description('Cross-platform agentic crypto payment CLI').version('0.1.0');

program
  .command('rails')
  .description('List supported payment rails')
  .action(() => {
    console.log(rails.SUPPORTED_ASSETS.join(', '));
  });

program
  .command('address <asset>')
  .description('Show this wallet\'s receiving address for an asset')
  .action(async (asset) => {
    try {
      const address = await rails.getAddress(asset.toUpperCase());
      console.log(address);
    } catch (err) {
      console.error('Error:', err.message);
      process.exitCode = 1;
    }
  });

program
  .command('balance <asset>')
  .description('Show current balance for an asset')
  .action(async (asset) => {
    try {
      const balance = await rails.getBalance(asset.toUpperCase());
      console.log(JSON.stringify(balance, null, 2));
    } catch (err) {
      console.error('Error:', err.message);
      process.exitCode = 1;
    }
  });

program
  .command('invoice')
  .description('Create an invoice for a given asset and amount')
  .requiredOption('--asset <asset>')
  .requiredOption('--amount <amount>', 'amount as a decimal number')
  .option('--memo <memo>')
  .option('--agent-id <agentId>', 'label for who this invoice is for', 'cli-user')
  .action(async (opts) => {
    try {
      const invoice = await rails.createInvoice({
        asset: opts.asset.toUpperCase(),
        amount: Number(opts.amount),
        memo: opts.memo,
        agentId: opts.agentId,
      });
      console.log(JSON.stringify(invoice, null, 2));
    } catch (err) {
      console.error('Error:', err.message);
      process.exitCode = 1;
    }
  });

program
  .command('send')
  .description('Send a payment')
  .requiredOption('--asset <asset>')
  .requiredOption('--to <address>')
  .requiredOption('--amount <amount>', 'amount as a decimal number')
  .requiredOption('--idempotency-key <key>', 'unique key to prevent duplicate sends')
  .option('--memo <memo>')
  .option('--agent-id <agentId>', 'label for spend-limit policy lookup', 'cli-user')
  .option('--confirmed', 'pass after human review, required above the confirmation floor', false)
  .action(async (opts) => {
    try {
      const result = await rails.sendPayment({
        agentId: opts.agentId,
        asset: opts.asset.toUpperCase(),
        to: opts.to,
        amount: Number(opts.amount),
        memo: opts.memo,
        confirmed: !!opts.confirmed,
        idempotencyKey: opts.idempotencyKey,
      });
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error('Error:', err.message);
      if (err.code) console.error('Code:', err.code);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
