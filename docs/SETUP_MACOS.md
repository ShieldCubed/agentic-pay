# Setup: macOS

## 1. Install Node.js 18+

```bash
brew install node
node -v
```

(No Homebrew? Install it from [brew.sh](https://brew.sh) first, or grab
the macOS installer directly from [nodejs.org](https://nodejs.org).)

## 2. Install and configure agentic-pay

```bash
cd agentic-pay
npm install
cp config/.env.example .env
cp config/config.example.json config/config.json
```

Edit both files with your rail-specific values.

## 3. Rail-specific setup

### BTC / ETH / XRP
No local daemon needed — same remote RPC/API setup as Linux
(`docs/SETUP_LINUX.md` section 3).

### XMR (Monero)

```bash
brew install monero
monero-wallet-rpc \
  --wallet-file /path/to/your/wallet \
  --password "your-wallet-password" \
  --rpc-bind-port 18082 \
  --rpc-login youruser:yourpass \
  --daemon-address node.example.com:18081 \
  --confirm-external-bind
```

### ZEC (Zcash)

```bash
brew install zcash
zcashd -rpcuser=youruser -rpcpassword=yourpass -rpcbind=127.0.0.1 -rpcport=8232
```

Wait for sync, then set `ZEC_FROM_ADDRESS` and the `ZEC_RPC_*` values in
`.env`.

## 4. Run it

```bash
npm run start:rest
npm run start:web
npm run start:mcp

node cli/index.js rails
node cli/index.js address BTC
```

## 5. Run at login (optional)

Use a `launchd` plist in `~/Library/LaunchAgents/` pointing at
`node server/restApi.js` with your project directory as
`WorkingDirectory`, or simply run it inside a `tmux`/`screen` session if
you don't need it to survive a reboot unattended.
