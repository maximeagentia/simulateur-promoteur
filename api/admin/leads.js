// api/admin/leads.js — lit les simulations depuis Supabase pour /admin.
// Remplace la lecture directe d'Airtable côté navigateur (avec token en
// dur) par un endpoint serveur qui exige un cookie de session valide et
// n'utilise la clé service_role que côté serveur.
const { isAuthenticated } = require('../_lib/admin-auth');
const { getSupabase } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'Non authentifié' });

  const sb = getSupabase();
  if (!sb) return res.status(200).json({ ok: true, records: [] });

  const { data, error } = await sb
    .from('simulations')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    console.error('[admin/leads]', error.message);
    return res.status(500).json({ error: error.message });
  }
  return res.status(200).json({ ok: true, records: data });
};
