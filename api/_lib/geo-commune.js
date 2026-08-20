// api/_lib/geo-commune.js — découverte du document PLU et de ses zones pour
// une commune entière (par opposition à plu.js qui interroge par point/parcelle).
//
// ATTENTION : le filtre `partition` sans `geom` sur apicarto.ign.fr/api/gpu/*
// n'a pas été testé en direct dans cette session — seule la variante par point
// (geom) a été vérifiée sur zone-urba et document. A confirmer avant le
// premier run réel (facile à repérer : getZonesPourCommune renverrait un
// tableau vide de façon systématique si le filtre n'est pas supporté tel quel).

async function fetchJson(url) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
  finally { clearTimeout(tid); }
}

async function getDocumentPourCommune(inseeCommune) {
  const partition = `DU_${inseeCommune}`;
  const url = `https://apicarto.ign.fr/api/gpu/document?partition=${encodeURIComponent(partition)}`;
  const data = await fetchJson(url);
  if (!data || !data.features || !data.features.length) return null;
  const props = data.features[0].properties || {};
  return {
    gpu_doc_id: props.gpu_doc_id || props.id,
    partition: props.partition,
    document_name: props.name,
    du_type: props.du_type,
  };
}

// Statut légal, date de dépôt et liens de téléchargement — API du Géoportail
// de l'Urbanisme (pas apicarto). Vérifié en direct (swagger + appel réel)
// dans cette session pour la structure de réponse.
async function getDetailsDocument(gpuDocId) {
  const url = `https://www.geoportail-urbanisme.gouv.fr/api/document/${encodeURIComponent(gpuDocId)}/details`;
  return await fetchJson(url);
}

async function getZonesPourCommune(inseeCommune) {
  const partition = `DU_${inseeCommune}`;
  const url = `https://apicarto.ign.fr/api/gpu/zone-urba?partition=${encodeURIComponent(partition)}&_limit=500`;
  const data = await fetchJson(url);
  if (!data || !data.features) return [];
  const codes = new Set();
  for (const f of data.features) {
    const p = f.properties || {};
    const code = (p.libelle || p.typezone || '').trim();
    if (code) codes.add(code);
  }
  return Array.from(codes);
}

module.exports = { getDocumentPourCommune, getDetailsDocument, getZonesPourCommune };
