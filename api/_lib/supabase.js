// api/_lib/supabase.js — client partagé, ne casse rien si non configuré
const { createClient } = require('@supabase/supabase-js');

let client;

function getSupabase() {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  client = (url && key) ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return client;
}

// Retourne la règle PLU réelle pour (commune, zone) si elle existe, sinon null.
// null déclenche systématiquement le repli sur la table statique ZONES_PLU.
async function getZonePLUFromSupabase(inseeCommune, zoneCode) {
  const sb = getSupabase();
  if (!sb || !inseeCommune || !zoneCode) return null;

  const { data, error } = await sb
    .from('plu_zones')
    .select('*')
    .eq('insee_commune', inseeCommune)
    .eq('zone_code', zoneCode)
    .neq('statut', 'echec')
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

// ── Utilisées par api/cron/extract-plu.js ──────────────────────────────────

async function getDocumentsATraiter(limite) {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('plu_documents')
    .select('*')
    .order('last_checked_at', { ascending: true, nullsFirst: true })
    .limit(limite || 5);
  return error ? [] : data;
}

async function upsertDocument(inseeCommune, champs) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('plu_documents').upsert(
    { insee_commune: inseeCommune, ...champs },
    { onConflict: 'insee_commune' }
  );
}

async function upsertZonePLU(inseeCommune, zoneCode, champs) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('plu_zones').upsert(
    { insee_commune: inseeCommune, zone_code: zoneCode, updated_at: new Date().toISOString(), ...champs },
    { onConflict: 'insee_commune,zone_code' }
  );
}

// Amorce une ligne plu_documents pour chaque commune cible qui n'en a pas
// encore (statut initial 'a_traiter', jamais vérifiée) — idempotent.
async function amorcerCommunesCibles(communes) {
  const sb = getSupabase();
  if (!sb) return;
  for (const c of communes) {
    const { data } = await sb
      .from('plu_documents')
      .select('insee_commune')
      .eq('insee_commune', c.insee)
      .maybeSingle();
    if (!data) {
      await sb.from('plu_documents').insert({ insee_commune: c.insee });
    }
  }
}

module.exports = {
  getSupabase,
  getZonePLUFromSupabase,
  getDocumentsATraiter,
  upsertDocument,
  upsertZonePLU,
  amorcerCommunesCibles,
};
