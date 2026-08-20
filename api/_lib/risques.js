// api/_lib/risques.js — couche risques (GeoRisques), appelée en direct comme
// BAN/cadastre : endpoints rapides et gratuits (georisques.gouv.fr/api/v1,
// sans token), pas besoin d'ingestion préalable contrairement au PLU
// (extraction PDF lente) et au DVF (statistiques sur des millions de
// lignes). Informationnel uniquement — n'ajuste pas le calcul du bilan,
// faute de coefficient objectivable pour traduire un risque en variation de
// prix.
//
// Endpoints + noms de champs vérifiés en direct (pas supposés) :
//   /api/v1/zonage_sismique?latlon=lon,lat  -> data[].{code_zone, zone_sismicite, code_insee}
//   /api/v1/cavites?rayon=&latlon=lon,lat   -> data[].{identifiant, type, longitude, latitude, code_insee}
//   /api/v1/gaspar/azi?rayon=&latlon=lon,lat -> data[].{code_national_azi, libelle_azi, liste_libelle_risque, code_insee}
//
// Patrimoine/ABF volontairement absent de cette couche : pas d'API nationale
// unifiée trouvée en vérifiant en direct — les périmètres de protection des
// monuments historiques sont publiés département par département sur
// data.gouv.fr, dans des formats hétérogènes (ex: MapInfo TAB), sans service
// web interrogeable par coordonnées. À traiter séparément (ingestion par
// téléchargement de fichiers département par département), pas simulé ici.

async function fetchJson(url) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
  finally { clearTimeout(tid); }
}

async function getZonageSismique(lat, lon) {
  const data = await fetchJson(`https://georisques.gouv.fr/api/v1/zonage_sismique?latlon=${lon},${lat}`);
  const item = data && Array.isArray(data.data) ? data.data[0] : null;
  if (!item) return null;
  return {
    code_zone: item.code_zone || null,
    libelle: item.zone_sismicite || null,
  };
}

async function getCavites(lat, lon, rayonM) {
  const data = await fetchJson(`https://georisques.gouv.fr/api/v1/cavites?rayon=${rayonM}&latlon=${lon},${lat}`);
  const items = data && Array.isArray(data.data) ? data.data : [];
  return {
    nb: items.length,
    rayon_m: rayonM,
    types: Array.from(new Set(items.map(c => c.type).filter(Boolean))),
  };
}

async function getInondation(lat, lon, rayonM) {
  const data = await fetchJson(`https://georisques.gouv.fr/api/v1/gaspar/azi?rayon=${rayonM}&latlon=${lon},${lat}`);
  const items = data && Array.isArray(data.data) ? data.data : [];
  return {
    nb_zones: items.length,
    rayon_m: rayonM,
    libelles: items.map(z => z.libelle_azi).filter(Boolean),
  };
}

// Chaque sous-appel est isolé (Promise.allSettled) : l'échec d'un endpoint
// GeoRisques ne doit jamais faire échouer toute la simulation.
async function getRisques(lat, lon) {
  const [sismique, cavites, inondation] = await Promise.allSettled([
    getZonageSismique(lat, lon),
    getCavites(lat, lon, 500),
    getInondation(lat, lon, 1000),
  ]);

  return {
    zonage_sismique: sismique.status === 'fulfilled' ? sismique.value : null,
    cavites: cavites.status === 'fulfilled' ? cavites.value : null,
    inondation: inondation.status === 'fulfilled' ? inondation.value : null,
    patrimoine: null, // voir commentaire en tête de fichier
    source: 'GeoRisques (georisques.gouv.fr/api/v1)',
  };
}

module.exports = { getRisques };
