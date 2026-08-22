// api/_lib/geo-commune.js — découverte du document PLU et de ses zones pour
// une commune entière (par opposition à plu.js qui interroge par point/parcelle).
//
// Le filtre `partition=DU_<insee>` échoue silencieusement pour toute commune
// couverte par un PLU intercommunal (PLUi) : le document est alors indexé
// sous le SIREN de l'EPCI, pas le code INSEE de la commune (vérifié en
// direct sur Toulouse : le vrai document est `DU_243100518` — SIREN de
// Toulouse Métropole — pas `DU_31555`). Dans ce cas on retombe sur une
// recherche géographique par le centroïde de la commune (geo.api.gouv.fr),
// qui trouve le document quel que soit son identifiant d'indexation.
//
// Le centroïde administratif peut lui-même tomber dans un petit périmètre
// de protection patrimoniale (PSMV) imbriqué dans le PLU/PLUi général — vu
// en direct sur Toulouse, dont le centroïde tombe pile dans le PSMV du
// centre historique, alors que tout point à ~1,5 km de là retombe sur le
// PLUi qui couvre le reste de la commune. Un PSMV n'a pas de règles
// CES/hauteur/reculs exploitables de la même façon qu'un PLU classique,
// donc on préfère un document de type PLU/PLUi/POS s'il y en a un à
// proximité immédiate — quitte à garder le PSMV si c'est vraiment tout ce
// qui existe pour cette commune (mieux que rien).
//
// Ça ne couvre pas tous les cas : certaines communes n'ont simplement aucun
// document numérisé sur le GPU pour l'instant (couverture nationale
// progressive, pas encore complète) — vérifié en direct sur Fouesnant
// (aucun document, ni par partition ni par géométrie, même sur une vraie
// adresse de centre-ville) : ça reste `document_introuvable`, à raison.

const DU_TYPES_GENERAUX = new Set(['PLU', 'PLUi', 'POS']);
// Petite couronne autour du centroïde (~1,5 km) pour sortir d'un éventuel
// périmètre PSMV imbriqué — valeur choisie empiriquement sur Toulouse.
const COURONNE_DEGRES = 0.015;

async function fetchJsonUneFois(url) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
  finally { clearTimeout(tid); }
}

// apicarto.ign.fr (API publique, gratuite, sans clé) répond de façon
// intermittente — observé en direct : le même appel échoue puis réussit
// d'un essai à l'autre sans rien changer côté client. getDocumentPourCommune
// enchaîne jusqu'à 9 appels séquentiels pour une commune ; sans retry, un
// seul de ces appels qui échoue transitoirement suffit à faire retomber sur
// "document_introuvable" à tort.
async function fetchJson(url) {
  const r1 = await fetchJsonUneFois(url);
  if (r1) return r1;
  return fetchJsonUneFois(url);
}

async function getCentroidCommune(inseeCommune) {
  const data = await fetchJson(`https://geo.api.gouv.fr/communes/${encodeURIComponent(inseeCommune)}?fields=centre`);
  const coords = data && data.centre && data.centre.coordinates;
  return Array.isArray(coords) && coords.length === 2 ? coords : null; // [lon, lat]
}

async function getDocumentParGeom(lonLat) {
  const geom = JSON.stringify({ type: 'Point', coordinates: lonLat });
  const url = `https://apicarto.ign.fr/api/gpu/document?geom=${encodeURIComponent(geom)}`;
  const data = await fetchJson(url);
  return data && data.features && data.features[0] ? data.features[0] : null;
}

async function getDocumentPourCommune(inseeCommune) {
  const partition = `DU_${inseeCommune}`;
  const url = `https://apicarto.ign.fr/api/gpu/document?partition=${encodeURIComponent(partition)}`;
  const data = await fetchJson(url);
  let feature = data && data.features && data.features[0];

  if (!feature) {
    const centre = await getCentroidCommune(inseeCommune);
    if (centre) {
      feature = await getDocumentParGeom(centre);

      // Document trouvé mais pas un PLU/PLUi/POS général (ex: PSMV imbriqué
      // pile au centroïde) : on tente une petite couronne de points autour
      // pour trouver le document général qui couvre le reste de la commune.
      if (feature && !DU_TYPES_GENERAUX.has((feature.properties || {}).du_type)) {
        const [lon, lat] = centre;
        const offsets = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1]];
        for (const [dx, dy] of offsets) {
          const alt = await getDocumentParGeom([lon + dx * COURONNE_DEGRES, lat + dy * COURONNE_DEGRES]);
          if (alt && DU_TYPES_GENERAUX.has((alt.properties || {}).du_type)) {
            feature = alt;
            break;
          }
        }
      }
    }
  }
  if (!feature) return null;

  const props = feature.properties || {};
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

// partition : celle réellement trouvée par getDocumentPourCommune (pas
// re-devinée depuis le code INSEE) — sinon on reproduit le même bug pour
// une commune couverte par un PLUi indexé sous le SIREN de l'EPCI.
async function getZonesPourCommune(partition) {
  if (!partition) return [];
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
