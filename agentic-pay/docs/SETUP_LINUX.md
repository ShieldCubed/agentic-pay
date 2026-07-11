# Setup: Linux

## 1. Install Node.js 18+

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # confirm >= 18
```

(Or use `nvm` if you prefer a per-user Node install instead of a system one.)

## 2. Install and build agentic-pay

```bash
cd agentic-pay
npm install
cp config/.env.example .env
cp config/config.example.json config/config.json
```

Edit `.env` and `config/config.json` with your values (see below for the
rail-specific pieces).

## 3. Rail-specific setup

### BTC / ETH / XRP
No local daemon required — these adapters talk to public/remote
endpoints (Esplora for BTC, any EVM RPC for ETH, XRPL cluster for XRP).
Just fill in the `.env` values. For ETH you need an RPC URL from a
provider (Infura, Alchemy) or your own node.

### XMR (Monero)
You need a synced Monero node and a running `monero-wallet-rpc`:

```bash
# Download the official Monero CLI bundle from getmonero.org, then:
./monero-wallet-rpc \
  --wallet-file /path/to/your/wallet \
  --password "your-wallet-password" \
  --rpc-bind-port 18082 \
  --rpc-login youruser:yourpass \
  --daemon-address node.example.com:18081 \
  --confirm-external-bind
```

Set `XMR_WALLET_RPC_URL=http://127.0.0.1:18082/json_rpc`,
`XMR_WALLET_RPC_USER=youruser`, `XMR_WALLET_RPC_PASS=yourpass` in `.env`.

If you don't want to run your own Monero node, `--daemon-address` can
point at a trusted remote node — search "Monero remote node list" for
current public options, and understand that a remote node operator can
see the IP address (though not the contents) of your requests.

### ZEC (Zcash)
You need a running `zcashd`:

```bash
# Install per https://z.cash/download/ then:
zcashd -rpcuser=youruser -rpcpassword=yourpass -rpcbind=127.0.0.1 -rpcport=8232
```

Wait for it to sync (`zcash-cli getblockchaininfo` to check progress),
then create/import an address and set `ZEC_FROM_ADDRESS` accordingly.
Set `ZEC_RPC_URL=http://127.0.0.1:8232`, `ZEC_RPC_USER`, `ZEC_RPC_PASS`
in `.env`.

## 4. Run it

```bash
npm run start:rest    # REST API, default port 8787
npm run start:web     # PWA static server, default port 8788
npm run start:mcp     # MCP stdio server, for Claude Desktop/Code

# or use the CLI directly:
node cli/index.js rails
node cli/index.js address BTC
```

## 5. Run as a systemd service (optional, for always-on agent access)

```ini
# /etc/systemd/system/agentic-pay-rest.service
[Unit]
Description=Agentic Pay REST API
After=network.target

[Service]
WorkingDirectory=/path/to/agentic-pay
ExecStart=/usr/bin/node server/restApi.js
Restart=on-failure
EnvironmentFile=/path/to/agentic-pay/.env
User=youruser

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now agentic-pay-rest
```
