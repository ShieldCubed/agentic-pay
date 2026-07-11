function apiBase() {
  return document.getElementById('apiBase').value.replace(/\/+$/, '');
}
function apiKey() {
  return document.getElementById('apiKey').value;
}
function show(obj) {
  document.getElementById('output').textContent =
    typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
}

async function callApi(path, opts = {}) {
  const res = await fetch(`${apiBase()}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey(),
      ...(opts.headers || {}),
    },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

async function getAddress() {
  const asset = document.getElementById('asset').value;
  try {
    show(await callApi(`/v1/address/${asset}`));
  } catch (e) {
    show(`Error: ${e.message}`);
  }
}

async function getBalance() {
  const asset = document.getElementById('asset').value;
  try {
    show(await callApi(`/v1/balance/${asset}`));
  } catch (e) {
    show(`Error: ${e.message}`);
  }
}

async function sendPayment() {
  const asset = document.getElementById('asset').value;
  const to = document.getElementById('toAddress').value;
  const amount = Number(document.getElementById('amount').value);
  const memo = document.getElementById('memo').value || undefined;
  const idempotencyKey = `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    show(
      await callApi('/v1/send', {
        method: 'POST',
        body: JSON.stringify({ asset, to, amount, memo, idempotencyKey }),
      })
    );
  } catch (e) {
    show(`Error: ${e.message}`);
  }
}
