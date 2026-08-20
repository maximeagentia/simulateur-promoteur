// api/_lib/dvf.js — prix marché via le DVF ingéré en base (Supabase/PostGIS)
// plutôt qu'un appel live à api.cquest.org à chaque simulation. Reprend
// exactement les mêmes seuils/filtres/moyenne tronquée que le chemin cquest
// existant (api/plu.js:getPrixMarche) pour ne pas changer la méthodologie de
// prix en changeant juste la source de données.
const { getSupabase } = require('./supabase');

const SEUILS = [
  { dist: 1000, min: 3 },
  { dist: 2000, min: 5 },
  { dist: 6000, min: 3 },
];

function calculerPrixDepuisTransactions(apparts, maisons) {
  const items = apparts.length >= 3 ? apparts : [...apparts, ...maisons];
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 5);

  const prixM2 = items
    .filter(r => {
      const surf = parseFloat(r.surface_reelle_bati || 0);
      const val = parseFloat(r.valeur_fonciere || 0);
      const date = new Date(r.date_mutation || '2000-01-01');
      return surf > 30 && val > 20000 && val < 6000000 && date > cutoff;
    })
    .map(r => parseFloat(r.valeur_fonciere) / parseFloat(r.surface_reelle_bati))
    .filter(p => p >= 1000 && p <= 20000);

  return { prixM2, typeLabel: apparts.length >= 3 ? 'appartements' : 'maisons/mixte' };
}

// Même contrat que getPrixMarche (plu.js) : null si aucun palier ne satisfait
// le minimum de transactions, sinon { prix, prix_ancien, coeff_neuf,
// nb_transactions, rayon_m, source, type }.
async function getPrixMarcheSupabase(lat, lon) {
  const sb = getSupabase();
  if (!sb) return null;

  for (const { dist, min } of SEUILS) {
    const [apparRes, maisonRes] = await Promise.all([
      sb.rpc('dvf_transactions_dans_rayon', { p_lat: lat, p_lon: lon, p_rayon_m: dist, p_type_local: 'Appartement' }),
      sb.rpc('dvf_transactions_dans_rayon', { p_lat: lat, p_lon: lon, p_rayon_m: dist, p_type_local: 'Maison' }),
    ]);
    if (apparRes.error || maisonRes.error) continue; // RPC absente (migration non appliquée) -> repli cquest

    const apparts = apparRes.data || [];
    const maisons = maisonRes.data || [];
    if (apparts.length + maisons.length < min) continue;

    const { prixM2, typeLabel } = calculerPrixDepuisTransactions(apparts, maisons);
    if (prixM2.length < min) continue;

    const sorted = prixM2.slice().sort((a, b) => a - b);
    const trim = Math.max(1, Math.floor(sorted.length * 0.10));
    const trimmed = sorted.slice(trim, sorted.length - trim);
    const moyenne = Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length);
    const prixNeuf = Math.round(moyenne * 1.15);

    return {
      prix: prixNeuf,
      prix_ancien: moyenne,
      coeff_neuf: 1.15,
      nb_transactions: prixM2.length,
      rayon_m: dist,
      source: `DVF ${prixM2.length} ${typeLabel} (rayon ${dist}m, base locale) × 1.15 neuf`,
      type: typeLabel,
    };
  }

  return null;
}

module.exports = { getPrixMarcheSupabase };
