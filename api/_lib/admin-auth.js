// api/_lib/admin-auth.js — session signée par cookie httpOnly pour /admin.
// Pas de store de session côté serveur : le cookie contient sa propre
// expiration et une signature HMAC vérifiée à chaque requête admin.
const crypto = require('crypto');

function getSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
}

function sign(payload) {
  const secret = getSecret();
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verify(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const secret = getSecret();
  const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req);
  return !!verify(cookies.admin_session);
}

const SESSION_DUREE_MS = 12 * 3600 * 1000; // 12h

function cookieConnexion() {
  const token = sign({ exp: Date.now() + SESSION_DUREE_MS });
  return `admin_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DUREE_MS / 1000}`;
}

function cookieDeconnexion() {
  return 'admin_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
}

module.exports = { isAuthenticated, cookieConnexion, cookieDeconnexion };
