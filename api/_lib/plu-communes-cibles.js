// api/_lib/plu-communes-cibles.js
//
// Priorise les communes à extraire sur le vrai trafic du site (table
// Airtable des simulations), recalculé à chaque passage du cron plutôt que
// figé une fois pour toutes — un lead sur une nouvelle commune fait
// remonter cette commune dans la file dès le lendemain.
//
// Le token Airtable est lu depuis l'environnement plutôt que recopié en dur
// ici — même s'il existe déjà en clair dans api/airtable.js (dette technique
// préexistante, hors périmètre de cette PR), pas de raison d'en ajouter une
// deuxième copie dans le repo. Sans cette variable, on retombe simplement
// sur la liste statique ci-dessous.
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || null;
const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || 'applqQPw8cx2pQ8NA';
const AIRTABLE_TABLE = process.env.AIRTABLE_TABLE_ID || 'tblzP5PQSTBj4B8LI';

// Repli si Airtable est inaccessible — communes réelles observées lors du
// développement de ce pipeline (extraction ponctuelle du 20/08/2026 sur les
// 72 simulations enregistrées à cette date), pas une liste générique de
// grandes villes.
const COMMUNES_CIBLES_REPLI = [
  { insee: "31555", nom: "Toulouse" },
  { insee: "97132", nom: "Trois-Rivières" },
  { insee: "63054", nom: "Le Broc" },
  { insee: "97205", nom: "Case-Pilote" },
  { insee: "95369", nom: "Margency" },
  { insee: "82115", nom: "Monclar-de-Quercy" },
  { insee: "33529", nom: "La Teste-de-Buch" },
  { insee: "93001", nom: "Aubervilliers" },
  { insee: "69233", nom: "Saint-Romain-au-Mont-d'Or" },
  { insee: "77357", nom: "Pécy" },
  { insee: "29058", nom: "Fouesnant" },
  { insee: "97416", nom: "Saint-Pierre" },
];

async function fetchJson(url, opts) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, Object.assign({ signal: ctrl.signal }, opts || {}));
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
  finally { clearTimeout(tid); }
}

// Extrait "code postal + ville" depuis le champ Adresse (texte libre, pas de
// champ INSEE dédié dans Airtable) et compte les occurrences.
function compterCommunes(records) {
  const compte = new Map();
  for (const rec of records) {
    const adresse = (rec.fields && rec.fields.Adresse || '').trim();
    const m = adresse.match(/(\d{5})\s+(.+)$/);
    if (!m) continue; // adresses de test/incomplètes sans code postal exploitable
    const cle = `${m[1]}|${m[2].trim()}`;
    compte.set(cle, (compte.get(cle) || 0) + 1);
  }
  return Array.from(compte.entries())
    .map(([cle, n]) => { const [cp, ville] = cle.split('|'); return { cp, ville, n }; })
    .sort((a, b) => b.n - a.n);
}

async function geocoderCommune(cp, ville) {
  const url = 'https://api-adresse.data.gouv.fr/search/?' + new URLSearchParams({
    q: `${ville} ${cp}`, type: 'municipality', limit: '1',
  });
  const data = await fetchJson(url);
  const props = data && data.features && data.features[0] && data.features[0].properties;
  if (!props || !props.citycode) return null;
  return { insee: props.citycode, nom: props.city || ville };
}

async function getCommunesCiblesDepuisAirtable(limite) {
  if (!AIRTABLE_TOKEN) return null; // AIRTABLE_TOKEN non configuré -> repli statique
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}?pageSize=100&fields%5B%5D=Adresse`;
  const data = await fetchJson(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
  if (!data || !data.records || !data.records.length) return null;

  const topCommunes = compterCommunes(data.records).slice(0, limite || 15);
  const resultats = [];
  const vus = new Set();
  for (const { cp, ville } of topCommunes) {
    const geo = await geocoderCommune(cp, ville);
    if (geo && !vus.has(geo.insee)) {
      vus.add(geo.insee);
      resultats.push(geo);
    }
  }
  return resultats.length ? resultats : null;
}

async function getCommunesCibles(limite) {
  const reelles = await getCommunesCiblesDepuisAirtable(limite);
  return reelles || COMMUNES_CIBLES_REPLI.slice(0, limite || COMMUNES_CIBLES_REPLI.length);
}

module.exports = { getCommunesCibles, COMMUNES_CIBLES_REPLI };
