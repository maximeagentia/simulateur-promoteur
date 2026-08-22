// api/simulation.js — écrit chaque simulation/contact dans Supabase.
// Remplace Airtable comme source de vérité (voir supabase/migrations/
// 0004_simulations.sql) — appelé en parallèle de /api/airtable pendant la
// transition, avant de retirer l'écriture Airtable.

const { insererSimulation } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
  } catch { return res.status(400).json({ error: 'Invalid JSON body' }); }

  // Honeypot anti-bot — même champ que le reste du site.
  if (body.website) return res.status(200).json({ ok: true, bot: true });

  const champs = {
    type: body.type === 'contact' ? 'contact' : 'simulation',
    adresse: body.adresse || null,
    insee_commune: body.insee_commune || null,
    latitude: Number.isFinite(body.lat) ? body.lat : null,
    longitude: Number.isFinite(body.lon) ? body.lon : null,
    surface_terrain: body.surface || null,
    surface_bati: body.surface_bati || null,
    cadastre: body.cadastre || null,
    zone_plu_libelle: body.zone_plu || null,
    zone_plu_code: body.zone_code || null,
    ces: body.ces || null,
    score: body.score || null,
    prix_marche_dvf: body.prix_marche || null,
    ca_ttc: body.ca_ttc || null,
    charge_fonciere: body.charge_fonciere || null,
    ratio_cf_ca: body.ratio_cf || null,
    marge_promo: body.marge_promoteur || null,
    val_low: body.val_low || null,
    val_high: body.val_high || null,
    cout_travaux: body.cout_travaux || null,
    nom: body.nom || null,
    prenom: body.prenom || null,
    email: body.email || null,
    tel: body.tel || null,
  };

  const id = await insererSimulation(champs);
  return res.status(200).json({ ok: true, id });
};
