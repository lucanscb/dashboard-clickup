// Shared, server-side settings store for the Weekly Reports module.
//
//   GET  /api/settings?ns=weekly-reports  -> { value: <object|null> }
//   PUT  /api/settings?ns=weekly-reports  -> { ok: true }   body: { value: <object> }
//
// Storage is an Upstash Redis REST database (no SDK, plain fetch). When the
// env vars are absent the endpoint reports 501 and the dashboard transparently
// falls back to per-browser localStorage — same data shape either way, so the
// feature works with or without a store configured.
//
// Namespaces are whitelisted so this can never be used as an open key/value
// store, and payload size is capped.

const NAMESPACES = ['weekly-reports'];
const MAX_BYTES = 256 * 1024;

function redisEnv() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function redisCmd(env, command) {
  const r = await fetch(env.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(command)
  });
  if (!r.ok) throw new Error('store ' + r.status);
  const j = await r.json();
  return j && j.result;
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > MAX_BYTES) reject(new Error('payload too large'));
    });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (e) { reject(new Error('invalid JSON')); } });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'PUT') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const ns = (req.query && req.query.ns) || '';
  if (!NAMESPACES.includes(ns)) {
    res.status(400).json({ error: 'unknown namespace' });
    return;
  }

  const env = redisEnv();
  if (!env) {
    // No store configured — the client keeps its own local copy.
    res.status(501).json({ error: 'no settings store configured', fallback: 'local' });
    return;
  }

  const key = 'dashboard-clickup:' + ns;
  try {
    if (method === 'GET') {
      const raw = await redisCmd(env, ['GET', key]);
      let value = null;
      try { value = raw ? JSON.parse(raw) : null; } catch (e) { value = null; }
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ value });
      return;
    }

    const body = await readBody(req);
    if (!body || typeof body.value !== 'object' || body.value === null) {
      res.status(400).json({ error: 'body must be { value: object }' });
      return;
    }
    const payload = JSON.stringify(body.value);
    if (payload.length > MAX_BYTES) {
      res.status(413).json({ error: 'payload too large' });
      return;
    }
    await redisCmd(env, ['SET', key, payload]);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e) });
  }
};
