// api/admin/logout.js — invalide le cookie de session admin.
const { cookieDeconnexion } = require('../_lib/admin-auth');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Set-Cookie', cookieDeconnexion());
  return res.status(200).json({ ok: true });
};
