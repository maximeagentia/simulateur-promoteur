// scripts/backfill-airtable-simulations.js
//
// Reprise ponctuelle de l'historique Airtable vers Supabase.simulations,
// avec géocodage des adresses (api-adresse.data.gouv.fr, public, sans clé)
// pour remplir latitude/longitude/insee_commune — utile pour la future
// fonction simulations_dans_rayon() de l'espace promoteur.
//
// Idempotent : upsert sur airtable_record_id (colonne ajoutée par la
// migration 0005). Déjà exécuté une fois manuellement (52 lignes reprises,
// 2 lignes de test Airtable ignorées) — conservé ici pour trace et pour un
// futur ré-import si de nouvelles lignes Airtable historiques apparaissent.
//
// Usage : AIRTABLE_TOKEN=... AIRTABLE_BASE_ID=... AIRTABLE_TABLE_ID=... \
//         SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-airtable-simulations.js

const { createClient } = require('@supabase/supabase-js');

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE = process.env.AIRTABLE_TABLE_ID;
const TYPES_VALIDES = new Set(['simulation', 'contact']);

async function fetchAirtableRecords() {
  let records = [];
  let url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AIRTABLE_TABLE)}?pageSize=100`;
  while (url) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    const d = await r.json();
    if (!r.ok) throw new Error('Airtable: ' + JSON.stringify(d));
    records = records.concat(d.records || []);
    url = d.offset
      ? `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AIRTABLE_TABLE)}?pageSize=100&offset=${d.offset}`
      : null;
  }
  return records;
}

async function geocode(adresse) {
  if (!adresse) return { lat: null, lon: null, insee: null };
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 5000);
  try {
    const url = 'https://api-adresse.data.gouv.fr/search/?q=' + encodeURIComponent(adresse) + '&limit=1';
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return { lat: null, lon: null, insee: null };
    const d = await r.json();
    const f = d.features && d.features[0];
    if (!f) return { lat: null, lon: null, insee: null };
    const [lon, lat] = f.geometry.coordinates;
    return { lat, lon, insee: f.properties.citycode || null };
  } catch {
    return { lat: null, lon: null, insee: null };
  } finally {
    clearTimeout(tid);
  }
}

(async () => {
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE || !AIRTABLE_TABLE) {
    console.error('AIRTABLE_TOKEN, AIRTABLE_BASE_ID et AIRTABLE_TABLE_ID sont requis.');
    process.exit(1);
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const records = await fetchAirtableRecords();
  let ok = 0, ignores = 0, geocoded = 0;

  for (const rec of records) {
    const f = rec.fields;
    const type = f.Type || 'simulation';
    if (!TYPES_VALIDES.has(type)) { ignores++; continue; } // ex: lignes "test" sans données réelles

    const { lat, lon, insee } = await geocode(f.Adresse);
    if (lat) geocoded++;

    const { error } = await sb.from('simulations').upsert({
      airtable_record_id: rec.id,
      created_at: rec.createdTime,
      type,
      adresse: f.Adresse || null,
      insee_commune: insee,
      latitude: lat,
      longitude: lon,
      surface_terrain: f.Surface ?? null,
      surface_bati: f['SHAB nette'] ?? null,
      cadastre: f.Cadastre || null,
      zone_plu_libelle: f['Zone PLU'] || null,
      score: f.Score ?? null,
      prix_marche_dvf: f['Prix marche DVF'] ?? null,
      ca_ttc: f['CA TTC'] ?? null,
      charge_fonciere: f['Charge fonciere'] ?? null,
      ratio_cf_ca: f['Ratio CF CA'] ?? null,
      marge_promo: f['Marge promo'] ?? null,
      val_low: f['Val low'] ?? null,
      val_high: f['Val high'] ?? null,
      cout_travaux: f['Cout travaux'] ?? null,
      nom: f.Nom || null,
      prenom: f.prenom || null,
      email: f['E-mail'] || null,
      tel: f.Tel || null,
    }, { onConflict: 'airtable_record_id' });

    if (error) console.error(`[${rec.id}] échec upsert:`, error.message);
    else ok++;

    await new Promise(r => setTimeout(r, 120)); // reste poli avec l'API de géocodage publique
  }

  console.log(`Terminé : ${ok} reprises, ${ignores} ignorées (type invalide), ${geocoded} géocodées.`);
})();
