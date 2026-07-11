# Security notes — read before sending real funds

## Key management

- Private keys and RPC credentials live only in `.env` (git-ignored) or
  your OS keychain. They are never written into any file this codebase
  commits.
- `config/.env.example` documents every secret needed; the real `.env`
  should never leave your machine.
- `core/keystore.js` is intentionally a thin, swappable module. For
  anything beyond local development, replace its `loadSecret()` calls
  with a real secrets manager:
  - **OS-level:** `keytar` (Windows Credential Manager / macOS Keychain
    / Linux libsecret)
  - **Cloud/production:** AWS Secrets Manager, HashiCorp Vault, GCP
    Secret Manager, or a hardware security module (HSM) for signing keys
    that must never touch application memory in plaintext.
- Consider a **hot/cold split**: keep only small, replenishable balances
  in the hot wallet this system signs with directly; keep the bulk of
  funds in cold storage and top up the hot wallet manually.

## Spend limits (`core/limits.js`)

This is the primary defense against a misbehaving or compromised agent.
Three independent guards, all configured per-agent in
`config/config.json`:

1. **Per-transaction cap** — hard reject, no exceptions.
2. **Rolling 24h cap** — hard reject once the agent's daily total is hit.
3. **Confirmation floor** — anything at or above this requires a human to
   have explicitly reviewed and set `confirmed: true`. Wire this to an
   actual human approval step (a Slack button, an email link, a manual
   CLI confirmation) — never let an agent set this flag on its own
   payments.

Set these conservatively at first and raise them only after you've
watched the system behave correctly under real (small) traffic.

## Idempotency

Every send requires a caller-supplied `idempotencyKey`. The ledger
(`core/ledger.js`) will return the original result for a repeated key
instead of sending again. This is what protects you from an agent's
retry logic (or a flaky network) causing a duplicate payment. Generate
one key per logical payment intent, not per HTTP attempt.

## The JSON-file ledger

`core/ledger.js` stores state in a single JSON file for portability and
zero native dependencies. This is fine for development and low-volume
personal use. For production with meaningful transaction volume, replace
it with a real database with proper transactional guarantees (the
function signatures are small and designed to be a drop-in swap).

## Network exposure

- Don't expose `restApi.js` (port 8787) directly to the public internet
  without HTTPS in front of it. Use a reverse proxy (nginx, Caddy) with a
  real TLS certificate, or a private tunnel (Tailscale, Cloudflare
  Tunnel, WireGuard) if this only needs to be reachable by your own
  devices/agents.
- The same applies to `monero-wallet-rpc` and `zcashd`'s RPC ports —
  these should generally only listen on `127.0.0.1` unless you have a
  specific, firewalled reason to do otherwise.

## Regulatory considerations

**This is general information, not legal advice — consult a lawyer
familiar with money-transmission law in your jurisdiction before
operating this for anyone other than yourself.**

Running software that sends and receives cryptocurrency on behalf of
other people or other people's agents can, depending on your
jurisdiction and exact business model, bring you into scope of
money-transmitter / money-services-business regulation:

- **United States:** FinCEN money-services-business (MSB) registration,
  and potentially state-by-state money-transmitter licensing, can apply
  if you're transmitting value on behalf of third parties rather than
  purely for yourself or a single legal entity you control.
- **EU:** MiCA (Markets in Crypto-Assets) and existing payment-services
  regulations may apply to custodial crypto services offered to others.
- **Elsewhere:** most jurisdictions have some analogous framework (FCA
  registration in the UK, AUSTRAC in Australia, etc.).

Using this purely for your own agents, moving your own funds, generally
carries much lower regulatory weight than operating it as a service for
third parties' funds — but the line depends on specifics (custody
arrangements, who controls the keys, whether you're facilitating
payments between unrelated parties) that are genuinely fact-specific.
If you're building toward the latter, get real legal advice before
launch, not after.

## Privacy-asset-specific notes (XMR, ZEC)

- Monero (XMR) and Zcash shielded (z-address) transactions are designed
  to obscure transaction graph data. Depending on your jurisdiction,
  some exchanges and payment processors treat privacy-coin flows with
  extra compliance scrutiny (e.g., many major exchanges have delisted
  XMR). Understand your counterparties' policies before relying on these
  rails for anything you'll later need to move through a regulated
  on/off-ramp.
- Zcash transparent (t-address) transactions behave like Bitcoin from a
  traceability standpoint — only shielded addresses get the privacy
  properties. `rails/zec.js` supports both; make sure you know which
  kind of address you're actually sending to/from.
