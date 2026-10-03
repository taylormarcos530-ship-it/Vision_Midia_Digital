const ALLOWED = new Set(['device-bootstrap','device-gateway','device-monitoring']);
const SUPABASE_URL = 'https://fpadgedrgcxrrqflzhjt.supabase.co';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, apikey, x-device-token, x-vision-function');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).send('ok');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const name = String(req.headers['x-vision-function'] || req.query?.fn || '').trim();
  if (!ALLOWED.has(name)) return res.status(400).json({ error: 'invalid_function' });

  const apiKey = String(req.headers.apikey || '');
  if (!apiKey) return res.status(400).json({ error: 'missing_apikey' });

  const headers = {
    apikey: apiKey,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': String(req.headers['user-agent'] || 'VisionPlayerProxy').slice(0, 500),
  };

  const deviceToken = String(req.headers['x-device-token'] || '');
  if (deviceToken) headers['x-device-token'] = deviceToken;

  const originalIp = String(
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for'] ||
    req.socket?.remoteAddress ||
    ''
  ).split(',')[0].trim();
  if (originalIp) headers['x-forwarded-for'] = originalIp;

  try {
    const upstream = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body || {}),
      redirect: 'follow',
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    return res.send(text);
  } catch (error) {
    return res.status(502).json({
      error: 'proxy_upstream_failed',
      message: String(error?.message || error || 'Falha de rede do proxy.').slice(0, 300),
    });
  }
};
