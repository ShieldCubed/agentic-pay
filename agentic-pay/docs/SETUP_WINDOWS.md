# Setup: Windows

## 1. Install Node.js 18+

Download the LTS installer from [nodejs.org](https://nodejs.org) and run
it (default options are fine). Confirm in PowerShell:

```powershell
node -v
npm -v
```

## 2. Install and configure agentic-pay

```powershell
cd agentic-pay
npm install
copy config\.env.example .env
copy config\config.example.json config\config.json
```

Edit `.env` and `config\config.json` in Notepad or your editor of choice
with your rail-specific values.

## 3. Rail-specific setup

### BTC / ETH / XRP
No local daemon needed. Fill in the remote RPC/API URLs in `.env` as
described in `docs/SETUP_LINUX.md` section 3 (identical values work on
Windows).

### XMR (Monero)
Download the Windows CLI bundle from getmonero.org, extract it, then
from PowerShell in that folder:

```powershell
.\monero-wallet-rpc.exe `
  --wallet-file C:\path\to\your\wallet `
  --password "your-wallet-password" `
  --rpc-bind-port 18082 `
  --rpc-login youruser:yourpass `
  --daemon-address node.example.com:18081 `
  --confirm-external-bind
```

Set the matching `XMR_WALLET_RPC_*` values in `.env`.

### ZEC (Zcash)
Zcash's official binaries target Linux/macOS primarily; on Windows the
most reliable path is running `zcashd` inside **WSL2** (Windows
Subsystem for Linux) and pointing `ZEC_RPC_URL` at
`http://127.0.0.1:8232` from within WSL2, or at the WSL2 VM's IP if
calling from native Windows. Alternatively, run `zcashd` on a separate
Linux machine/VM and point `ZEC_RPC_URL` at it over your network (use a
strong `ZEC_RPC_PASS` and firewall rules if doing this — do not expose
zcashd's RPC port to the public internet).

## 4. Run it

```powershell
npm run start:rest
npm run start:web
npm run start:mcp

node cli\index.js rails
node cli\index.js address BTC
```

## 5. Run at startup (optional)

Use **Task Scheduler** to run `node server\restApi.js` with a trigger of
"At log on", working directory set to your project folder, or use
[`nssm`](https://nssm.cc/) to install it as a proper Windows service if
you want it running even when no user is logged in.
