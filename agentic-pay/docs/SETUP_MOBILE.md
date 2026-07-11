# Setup: iOS and Android (Progressive Web App)

There is no native iOS/Android codebase in this project. Instead, the
`web/` folder is an installable **Progressive Web App (PWA)** that talks
to the same REST API used everywhere else. This is the realistic way to
get one codebase working across desktop and mobile without maintaining
separate Swift/Kotlin apps — and it's exactly what companies like
Twitter/X and Starbucks do for their mobile-web app experiences.

## Prerequisites

- A computer on the same Wi-Fi network as your phone, running:
  ```bash
  npm run start:rest    # the API the app talks to
  npm run start:web     # serves the app itself
  ```
- That computer's **LAN IP address** (not `localhost` — your phone can't
  reach your computer's localhost). Find it with:
  - macOS/Linux: `ifconfig | grep inet` or `ip addr`
  - Windows: `ipconfig` (look for "IPv4 Address")

## iOS (Safari)

1. On your iPhone/iPad, open **Safari** and go to
   `http://<your-computer's-LAN-IP>:8788`
2. Tap the **Share** button (square with an arrow)
3. Tap **Add to Home Screen**
4. Name it "Agentic Pay" and tap **Add**
5. Launch it from your home screen — it opens full-screen, without
   Safari's address bar, behaving like an installed app

## Android (Chrome)

1. On your Android device, open **Chrome** and go to
   `http://<your-computer's-LAN-IP>:8788`
2. Tap the **⋮** menu in the top right
3. Tap **Add to Home screen** (Chrome may also show an automatic
   "Install app" banner/prompt — either works)
4. Confirm the name and tap **Add**
5. Launch it from your home screen or app drawer

## First launch: connect it to your API

The app itself doesn't hardcode a server address (your phone and your
computer both need to agree on the computer's LAN IP, which changes
across networks). On first launch:

1. Enter `http://<your-computer's-LAN-IP>:8787` in the **API base URL**
   field
2. Enter the API key that corresponds to an `agentId` you configured in
   `config/config.json` under `apiKeys`
3. Pick an asset, tap **Show receiving address** or **Check balance** to
   confirm the connection works before trying to send anything

## Exposing this beyond your home network

For remote access (not just same-Wi-Fi), put the REST API behind a
reverse proxy with HTTPS (e.g., Caddy, nginx + Let's Encrypt, or a
tunneling service like Tailscale/Cloudflare Tunnel) rather than exposing
port 8787 directly to the internet. See `docs/SECURITY.md`.
