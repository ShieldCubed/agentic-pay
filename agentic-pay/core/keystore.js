'use strict';
/**
 * keystore.js
 *
 * Centralized secret loading. Secrets are NEVER stored in this repo or in
 * code. They are read from environment variables (populated from a local
 * .env file that you create from config/.env.example and keep out of
 * version control).
 *
 * Extension point: replace `loadSecret()` with calls into your OS's native
 * credential store for production use:
 *   - Linux:   libsecret / gnome-keyring, or `pass`
 *   - Windows: Windows Credential Manager (via the `keytar` npm package)
 *   - macOS:   Keychain Services (via the `keytar` npm package)
 * This keeps private keys out of plaintext files entirely. `keytar` is not
 * bundled by default here to keep the base install free of native
 * compilation requirements; add it yourself if you want OS-keychain backing.
 */

require('dotenv').config();

function loadSecret(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required secret "${name}". Set it in your .env file ` +
      `(see config/.env.example) or your OS keychain.`
    );
  }
  return value;
}

function loadOptional(name, fallback = undefined) {
  return process.env[name] !== undefined ? process.env[name] : fallback;
}

module.exports = { loadSecret, loadOptional };
