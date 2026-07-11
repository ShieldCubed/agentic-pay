'use strict';
/**
 * server/staticWeb.js
 *
 * Serves the PWA in /web. Run this alongside restApi.js. On your phone,
 * visit http://<your-computer's-LAN-IP>:8788 in Safari (iOS) or Chrome
 * (Android) and use "Add to Home Screen" — that's what makes it behave
 * like an installed app on mobile without a native build. See
 * docs/SETUP_MOBILE.md for exact steps and screenshots-equivalent text.
 *
 * Default port: 8788 (override with WEB_PORT env var)
 */

const express = require('express');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, '..', 'web')));

const PORT = process.env.WEB_PORT || 8788;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`agentic-pay PWA served at http://localhost:${PORT}`);
  console.log('For mobile access, use your computer\'s LAN IP instead of localhost.');
});
