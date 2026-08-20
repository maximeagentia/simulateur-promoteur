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

module.exports = { getSupabase, getZonePLUFromSupabase };
