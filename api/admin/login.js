// api/admin/login.js — vérifie le mot de passe admin (env var) et pose un
// cookie de session signé (voir ../_lib/admin-auth.js). Le mot de passe ne
// transite jamais côté client au-delà de cette requête, contrairement à
// l'ancien admin.html qui le comparait en JS dans le navigateur.
const crypto = require('crypto');
const { cookieConnexion } = require('../_lib/admin-auth');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  if (!ADMIN_PASSWORD) {
    console.warn('[admin] ADMIN_PASSWORD non configuré');
    return res.status(500).json({ error: 'Admin non configuré' });
  }

  let body = {};
  try {
    if (typeof req.body === 'string') body = JSON.parse(req.body);
    else if (req.body && typeof req.body === 'object') body = req.body;
    else {
      const raw = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(data));
        req.on('error', reject);
      });
      body = raw ? JSON.parse(raw) : {};
    }
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const provided = Buffer.from(String(body.password || ''));
  const expected = Buffer.from(ADMIN_PASSWORD);
  const ok = provided.length === expected.length && crypto.timingSafeEqual(provided, expected);

  if (!ok) {
    await new Promise(r => setTimeout(r, 400)); // ralentit un bruteforce naïf
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  }

  res.setHeader('Set-Cookie', cookieConnexion());
  return res.status(200).json({ ok: true });
};
