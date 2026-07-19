'use strict';
/**
 * alerts.js
 *
 * Slack + email notifications for spend events. Fire-and-forget by design —
 * a Slack/SMTP outage must never block or delay an actual payment. Callers
 * pass the already-loaded `alerts` config block (from config.json) rather
 * than this module loading it itself, to avoid a require() cycle with
 * limits.js.
 *
 * Config shape (config.json -> alerts):
 *   {
 *     "slackWebhookUrl": null,
 *     "email": { "enabled": false, "smtpHost": null, "smtpPort": 587,
 *                "smtpUser": null, "smtpPass": null, "from": null, "to": null },
 *     "notifyOn": ["send_success", "confirmation_required", "policy_violation"]
 *   }
 *
 * Email requires the optional "nodemailer" dependency:
 *   npm install nodemailer
 * If it's not installed and email is enabled, the failure is logged (not
 * thrown) — alerts must never crash the payment path.
 */

let mailTransport = null;

function getMailTransport(emailCfg) {
  if (!emailCfg?.enabled) return null;
  if (mailTransport) return mailTransport;
  try {
    const nodemailer = require('nodemailer');
    mailTransport = nodemailer.createTransport({
      host: emailCfg.smtpHost,
      port: emailCfg.smtpPort,
      auth: { user: emailCfg.smtpUser, pass: emailCfg.smtpPass },
    });
    return mailTransport;
  } catch (err) {
    console.error(
      'Email alerts are enabled in config.json but "nodemailer" is not ' +
      'installed. Run `npm install nodemailer`, or set alerts.email.enabled ' +
      'to false.'
    );
    return null;
  }
}

async function sendSlackAlert(webhookUrl, text) {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.error('Slack alert failed:', err.message);
  }
}

async function sendEmailAlert(emailCfg, subject, text) {
  const transport = getMailTransport(emailCfg);
  if (!transport) return;
  try {
    await transport.sendMail({ from: emailCfg.from, to: emailCfg.to, subject, text });
  } catch (err) {
    console.error('Email alert failed:', err.message);
  }
}

function formatMessage(eventType, payload) {
  switch (eventType) {
    case 'send_success':
      return `✅ agentic-pay: agent "${payload.agentId}" sent ${payload.amount} ${payload.asset} ` +
             `to ${payload.to} (tx: ${payload.txId})`;
    case 'confirmation_required':
      return `⏳ agentic-pay: agent "${payload.agentId}" attempted a send of ~${payload.usdEquivalent} ` +
             `USD that requires human confirmation.`;
    case 'policy_violation':
      return `🚫 agentic-pay: policy violation for agent "${payload.agentId}" — ${payload.message}`;
    default:
      return `agentic-pay: ${eventType} — ${JSON.stringify(payload)}`;
  }
}

/**
 * Fire-and-forget notification. Never throws — callers should NOT await
 * this in a way that blocks the payment path; call it and let it run.
 */
async function notify(eventType, payload, alertsCfg) {
  if (!alertsCfg) return;
  const enabledEvents = alertsCfg.notifyOn || [];
  if (!enabledEvents.includes(eventType)) return;

  const text = formatMessage(eventType, payload);
  await Promise.all([
    sendSlackAlert(alertsCfg.slackWebhookUrl, text),
    sendEmailAlert(alertsCfg.email, `agentic-pay: ${eventType}`, text),
  ]);
}

module.exports = { notify };
