// api/plu.js — EstimationTerrain.fr
// Backend serverless Vercel (CommonJS)
// APIs : apicarto.ign.fr (GPU + cadastre) · DVF etalab · BAN
// Zone PLU : lookup Supabase (plu_zones, règles réelles extraites) avec repli
// sur la table statique ci-dessous (calibrée sur le seul PLUi Vallée Sud Grand
// Paris) tant qu'une commune n'a pas encore été extraite. Voir supabase/migrations.

const { getZonePLUFromSupabase } = require('./_lib/supabase');
const { surfaceApresReculs } = require('./_lib/geometrie');

// ─── Table zones PLU (extraite du PLUi Vallée Sud + valeurs nationales) ───────
const ZONES_PLU = {
  // Zones U1 pavillonnaires Vallée Sud Grand Paris
  "U1a":  { label:"Zone pavillonnaire U1a",           ces:0.35, hauteur:7,  niveaux:2 },
  "U1b":  { label:"Zone pavillonnaire dense U1b",      ces:0.40, hauteur:7,  niveaux:2 },
  "U1c":  { label:"Zone pavillonnaire U1c",            ces:0.35, hauteur:8,  niveaux:3 },
  "U1d":  { label:"Zone pavillonnaire protégée U1d",   ces:0.20, hauteur:7,  niveaux:2 },
  "U1e":  { label:"Zone densifiable U1e",              ces:0.40, hauteur:10, niveaux:3 },
  "U1f":  { label:"Zone U1f (bande constructib.)",     ces:0.35, hauteur:7,  niveaux:2 },
  "U1g":  { label:"Zone grands terrains U1g",          ces:0.35, hauteur:8,  niveaux:2 },
  "U1P":  { label:"Zone patrimoniale U1P",             ces:0.35, hauteur:8,  niveaux:2 },
  "U1Pb": { label:"Zone patrimoniale U1Pb",            ces:0.30, hauteur:7,  niveaux:2 },
  // Zones mixtes / collectifs
  "U2":   { label:"Zone de centralité U2",             ces:0.80, hauteur:12, niveaux:4 },
  "U3":   { label:"Zone mixte U3",                     ces:0.70, hauteur:15, niveaux:5 },
  "U4":   { label:"Zone grandes résidences U4",        ces:0.40, hauteur:15, niveaux:6 },
  "U5":   { label:"Zone économique U5",                ces:0.60, hauteur:10, niveaux:3 },
  // Zones nationales génériques (hors Vallée Sud)
  "UA":   { label:"Zone UA (centre urbain dense)",     ces:0.70, hauteur:15, niveaux:5 },
  "UAa":  { label:"Zone UAa",                          ces:0.80, hauteur:18, niveaux:6 },
  "UAb":  { label:"Zone UAb",                          ces:0.60, hauteur:12, niveaux:4 },
  "UB":   { label:"Zone UB (tissu mixte)",             ces:0.50, hauteur:12, niveaux:4 },
  "UBa":  { label:"Zone UBa",                          ces:0.55, hauteur:12, niveaux:4 },
  "UBb":  { label:"Zone UBb",                          ces:0.45, hauteur:9,  niveaux:3 },
  "UC":   { label:"Zone UC (pavillonnaire collectif)", ces:0.40, hauteur:9,  niveaux:3 },
  "UCa":  { label:"Zone UCa",                          ces:0.40, hauteur:9,  niveaux:3 },
  "UD":   { label:"Zone UD (pavillonnaire)",           ces:0.35, hauteur:7,  niveaux:2 },
  "UDa":  { label:"Zone UDa",                          ces:0.30, hauteur:7,  niveaux:2 },
  "UE":   { label:"Zone UE (équipements)",             ces:0.40, hauteur:9,  niveaux:3 },
  "UH":   { label:"Zone UH (habitat dense)",           ces:0.50, hauteur:12, niveaux:4 },
  "UI":   { label:"Zone UI (activités)",               ces:0.60, hauteur:10, niveaux:3 },
  "UX":   { label:"Zone UX (mixte/commerce)",          ces:0.60, hauteur:12, niveaux:4 },
  "UZ":   { label:"Zone UZ",                           ces:0.40, hauteur:9,  niveaux:3 },
  // Zones à urbaniser
  "AU":   { label:"Zone AU (à urbaniser)",             ces:0.40, hauteur:9,  niveaux:3 },
  "AUa":  { label:"Zone AUa",                          ces:0.45, hauteur:9,  niveaux:3 },
  "AUb":  { label:"Zone AUb",                          ces:0.35, hauteur:7,  niveaux:2 },
  "1AU":  { label:"Zone 1AU",                          ces:0.40, hauteur:9,  niveaux:3 },
  "2AU":  { label:"Zone 2AU (urbanisation future)",    ces:0.30, hauteur:7,  niveaux:2 },
  // Zones non constructibles
  "A":    { label:"Zone agricole",                     ces:0,    hauteur:0,  niveaux:0 },
  "N":    { label:"Zone naturelle",                    ces:0,    hauteur:0,  niveaux:0 },
  "Na":   { label:"Zone Na",                           ces:0,    hauteur:0,  niveaux:0 },
  "Nb":   { label:"Zone Nb",                           ces:0,    hauteur:0,  niveaux:0 },
  "Np":   { label:"Zone naturelle protégée",           ces:0,    hauteur:0,  niveaux:0 },
  // Fallback
  "_fallback": { label:"Zone non identifiée",         ces:0.35, hauteur:9,  niveaux:3 }
};

// ─── Résolution code GPU → clé ZONES_PLU ─────────────────────────────────────
function resolveZone(code) {
  if (!code) return "_fallback";
  const c = code.trim();
  // Match exact
  if (ZONES_PLU[c]) return c;
  // Sans caractères spéciaux (ex: "U1a*" → "U1a")
  const clean = c.replace(/[^A-Za-z0-9]/g, "");
  if (ZONES_PLU[clean]) return clean;
  // Préfixe 3 chars (ex: "UCa" → "UC")
  if (ZONES_PLU[clean.substring(0, 3)]) return clean.substring(0, 3);
  // Préfixe 2 chars
  if (ZONES_PLU[clean.substring(0, 2)]) return clean.substring(0, 2);
  // Majuscule 2 chars
  const up2 = clean.substring(0, 2).toUpperCase();
  if (ZONES_PLU[up2]) return up2;
  return "_fallback";
}

// ─── Calcul bilan promoteur — logique réelle ──────────────────────────────────
// Standard professionnel (PACA/IDF) :
// 1. Surface au sol = terrain × CES
// 2. SHAB brute = surface_sol × (hauteur / 2.80m)
// 3. SHAB nette = brute × 0.85 (parties communes)
// 4. CA TTC = SHAB nette × prix marché neuf
// 5. CA HT = CA TTC / 1.20 (TVA 20%)
// 6. Coût construction = SHAB nette × 1650 €/m² (travaux + VRD)
// 7. Frais architecte/BET = coût travaux × 8%
// 8. Commercialisation = CA TTC × 5%
// 9. Frais financiers = CA TTC × 4%
// 10. Marge promoteur min = CA TTC × 20%
// 11. CF = CA HT - construction - archi - commerçialisation - financiers - marge
// 12. Fourchette: low = CF × 0.85, high = low × 1.35
function calculBilan(surfaceTerrain, zoneKey, prixMarche, zoneReelle, parcelGeometry) {
  // zoneReelle (Supabase, plu_zones) prévaut sur la table statique quand disponible.
  const zoneStatique = ZONES_PLU[zoneKey] || ZONES_PLU["_fallback"];
  const zone = zoneReelle ? {
    label: zoneReelle.zone_label || zoneStatique.label,
    ces: zoneReelle.ces != null ? Number(zoneReelle.ces) : zoneStatique.ces,
    hauteur: zoneReelle.hauteur_m != null ? Number(zoneReelle.hauteur_m) : zoneStatique.hauteur,
  } : zoneStatique;
  const source_zone = zoneReelle ? "plu_zones (extraction réelle)" : "table statique (générique)";

  if (zone.ces === 0) {
    return {
      constructible: false,
      zone_label: zone.label,
      zone_key: zoneKey,
      source_zone,
      raison: "Zone non constructible pour le logement"
    };
  }

  const H_ETAGE = 2.80;
  const COEFF_ARCHI_BET  = 0.08;  // 8% travaux — constant
  const COEFF_COMMERC    = 0.05;  // 5% CA TTC — constant
  const COEFF_FINANCIER  = 0.04;  // 4% CA TTC — constant
  const TVA              = 1.20;

  // Coût construction et marge selon le marché local
  // Proxy : prix de sortie neuf — reflète la tension du marché
  // IDF / Paris (prix neuf > 4600) : construction 1650€, marge 20%
  // Grandes métropoles (3200–4600) : construction 1400€, marge 17%
  // Province standard (< 3200) : construction 1200€, marge 15%
  const prixNeufEstime = prixMarche; // prixMarche est déjà le prix neuf (DVF × 1.15)
  const COUT_CONSTRUCTION_M2 = prixNeufEstime > 4600 ? 1650
    : prixNeufEstime > 3200 ? 1400
    : 1200;
  const COEFF_MARGE = prixNeufEstime > 4600 ? 0.20
    : prixNeufEstime > 3200 ? 0.17
    : 0.15;

  const surface_au_sol_ces = Math.round(surfaceTerrain * zone.ces);
  // Emprise après reculs réels (érosion géométrique du polygone cadastral) —
  // seulement si on a une géométrie ET des reculs extraits (zoneReelle).
  // Les deux contraintes s'appliquent simultanément : on garde la plus restrictive.
  const reculFacade = zoneReelle && zoneReelle.recul_facade_m != null ? Number(zoneReelle.recul_facade_m) : null;
  const reculLimites = zoneReelle && zoneReelle.recul_limites_m != null ? Number(zoneReelle.recul_limites_m) : null;
  const surface_apres_reculs = surfaceApresReculs(parcelGeometry, reculFacade, reculLimites);
  const surface_au_sol = surface_apres_reculs !== null
    ? Math.min(surface_au_sol_ces, surface_apres_reculs)
    : surface_au_sol_ces;
  const source_emprise = surface_apres_reculs !== null ? "géométrie réelle (reculs)" : "CES seul";
  const nb_niveaux     = Math.floor(zone.hauteur / H_ETAGE);
  const shab_brute     = Math.round(surface_au_sol * nb_niveaux);
  const shab_nette     = Math.round(shab_brute * 0.85);

  // CA
  const ca_ttc = Math.round(shab_nette * prixMarche);
  const ca_ht  = Math.round(ca_ttc / TVA);

  // Charges promoteur
  const cout_travaux  = Math.round(shab_nette * COUT_CONSTRUCTION_M2);
  const cout_archi    = Math.round(cout_travaux * COEFF_ARCHI_BET);
  const cout_commerc  = Math.round(ca_ttc * COEFF_COMMERC);
  const cout_financier= Math.round(ca_ttc * COEFF_FINANCIER);
  const marge_promo   = Math.round(ca_ttc * COEFF_MARGE);

  // Charge foncière résiduelle
  const cf = Math.max(0, ca_ht - cout_travaux - cout_archi - cout_commerc - cout_financier - marge_promo);

  // Ratio CF/CA TTC (cohérence : doit être entre 8% et 30%)
  const ratio_cf_ca = ca_ttc > 0 ? Math.round((cf / ca_ttc) * 100) : 0;

  // Fourchette valeur terrain net vendeur
  const val_low  = Math.round(cf * 0.85 / 1000) * 1000;
  const val_high = Math.round(val_low * 1.35 / 1000) * 1000;

  return {
    constructible: true,
    zone_label: zone.label,
    zone_key: zoneKey,
    source_zone,
    source_emprise,
    parametres: {
      ces: zone.ces,
      hauteur_acrotere: zone.hauteur,
      nb_niveaux_calcules: nb_niveaux,
      h_etage: H_ETAGE,
      recul_facade_m: reculFacade,
      recul_limites_m: reculLimites
    },
    calcul: {
      surface_terrain: Math.round(surfaceTerrain),
      surface_au_sol,
      shab_brute,
      shab_nette,
      prix_marche_m2: Math.round(prixMarche),
      ca_ttc,
      ca_ht,
      cout_travaux,
      cout_archi_bet: cout_archi,
      cout_commercialisation: cout_commerc,
      cout_financier,
      marge_promoteur: marge_promo,
      charge_fonciere: cf,
      ratio_cf_ca_pct: ratio_cf_ca
    },
    valeur_terrain: {
      low: val_low,
      high: val_high,
      low_m2: surfaceTerrain > 0 ? Math.round(val_low / surfaceTerrain) : 0,
      high_m2: surfaceTerrain > 0 ? Math.round(val_high / surfaceTerrain) : 0
    }
  };
}

// ─── Fetch helper avec timeout ────────────────────────────────────────────────
async function fetchJson(url, opts) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(url, Object.assign({ signal: ctrl.signal }, opts || {}));
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
  finally { clearTimeout(tid); }
}

// ─── API GPU apicarto.ign.fr ──────────────────────────────────────────────────
// Doc : https://apicarto.ign.fr/api/doc/gpu
// Endpoint zone-urba : renvoie les zonages PLU/POS/CC intersectant un point
async function getZonePLU(lat, lon) {
  const geom = encodeURIComponent(JSON.stringify({
    type: "Point",
    coordinates: [lon, lat]
  }));
  const url = `https://apicarto.ign.fr/api/gpu/zone-urba?geom=${geom}`;
  const data = await fetchJson(url);
  if (!data || !data.features || !data.features.length) return null;

  const props = data.features[0].properties;
  // Le champ libelle contient le code zone (ex: "UA", "UB", "N"...)
  // libelong = libellé long, typezone = type générique
  return {
    code: props.libelle || props.typezone || null,
    libelle_long: props.libelong || null,
    partition: props.partition || null, // identifiant du PLU source
    gpu_source: true
  };
}

// ─── API DVF etalab ───────────────────────────────────────────────────────────
// Utilise l'API DVF officielle d'etalab (geoportail-urbanisme / data.gouv)
// Fallback département si DVF+ insuffisant
async function getPrixMarche(lat, lon, codeCommune) {
  // ── API Christian Quest DVF — rayon progressif ────────────────────────────
  // Source : api.cquest.org/dvf (données DGFiP/data.gouv.fr)
  // Filtre type_local directement dans l'URL → pas de pollution par terrains/garages
  // Rayon progressif : 1km → 2km → 6km (logique métier demandée)
  
  const SEUILS = [
    { dist: 1000, min: 3 },   // 1km → minimum 3 transactions
    { dist: 2000, min: 5 },   // 2km → minimum 5 transactions
    { dist: 6000, min: 3 },   // 6km → au moins 3 si zone peu dense
  ];

  for (const { dist, min } of SEUILS) {
    // Appartements d'abord (prix plus représentatifs du neuf collectif)
    const urlAppart = `https://api.cquest.org/dvf?lat=${lat}&lon=${lon}&dist=${dist}&nature_mutation=Vente&type_local=Appartement`;
    const urlMaison = `https://api.cquest.org/dvf?lat=${lat}&lon=${lon}&dist=${dist}&nature_mutation=Vente&type_local=Maison`;

    const [dataAppart, dataMaison] = await Promise.all([
      fetchJson(urlAppart),
      fetchJson(urlMaison)
    ]);

    const apparts = (dataAppart && dataAppart.resultats) ? dataAppart.resultats : [];
    const maisons = (dataMaison && dataMaison.resultats) ? dataMaison.resultats : [];

    // Priorité appartements si ≥ 3, sinon mix
    const items = apparts.length >= 3 ? apparts : [...apparts, ...maisons];

    if (items.length < min) continue;

    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 5);

    const prixM2 = items
      .filter(r => {
        const surf = parseFloat(r.surface_reelle_bati || 0);
        const val  = parseFloat(r.valeur_fonciere || 0);
        const date = new Date(r.date_mutation || "2000-01-01");
        return surf > 30 && val > 20000 && val < 6000000 && date > cutoff;
      })
      .map(r => parseFloat(r.valeur_fonciere) / parseFloat(r.surface_reelle_bati))
      .filter(p => p >= 1000 && p <= 20000);

    if (prixM2.length < min) continue;

    // Moyenne tronquée (retire 10% extrêmes)
    const sorted = prixM2.slice().sort((a, b) => a - b);
    const trim   = Math.max(1, Math.floor(sorted.length * 0.10));
    const trimmed = sorted.slice(trim, sorted.length - trim);
    const moyenne = Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length);

    // +15% prix neuf (RE2020, garanties, standing)
    const prixNeuf = Math.round(moyenne * 1.15);
    const typeLabel = apparts.length >= 3 ? "appartements" : "maisons/mixte";

    return {
      prix: prixNeuf,
      prix_ancien: moyenne,
      coeff_neuf: 1.15,
      nb_transactions: prixM2.length,
      rayon_m: dist,
      source: `DVF ${prixM2.length} ${typeLabel} (rayon ${dist}m) × 1.15 neuf`,
      type: typeLabel
    };
  }

  // Fallback département uniquement si vraiment aucune donnée DVF dans 6km
  return null;
}

// Filtre strict logements + calcul prix neuf (utilisé uniquement par le fallback Cerema)
function filtrerEtCalculer(items, source) {
  if (!items || !items.length) return null;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 5);

  const logements = items.filter(r => {
    const type = r.libtypbien || r.type_local || "";
    const surf = parseFloat(r.sbati || r.surface_reelle_bati || 0);
    const val  = parseFloat(r.valeurfonc || r.valeur_fonciere || 0);
    const date = new Date(r.date_mutation || r.datemut || "2000-01-01");
    const isLogement = /maison|appartement/i.test(type) ||
                       type === "Maison" || type === "Appartement";
    return isLogement && surf > 30 && val > 20000 && val < 8000000 && date > cutoff;
  });

  if (logements.length < 3) return null;

  const prixM2 = logements
    .map(r => parseFloat(r.valeurfonc || r.valeur_fonciere || 0) / parseFloat(r.sbati || r.surface_reelle_bati || 1))
    .filter(p => p >= 1200 && p <= 20000);

  if (prixM2.length < 3) return null;

  const sorted = prixM2.slice().sort((a, b) => a - b);
  const trim   = Math.max(1, Math.floor(sorted.length * 0.10));
  const trimmed = sorted.slice(trim, sorted.length - trim);
  const moyenne = Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length);
  const prixNeuf = Math.round(moyenne * 1.15);

  return {
    prix: prixNeuf,
    prix_ancien: moyenne,
    coeff_neuf: 1.15,
    nb_transactions: prixM2.length,
    source: `DVF+ Cerema ${prixM2.length} transactions (${source}) × 1.15 neuf`,
    type: "logements"
  };
}

// ─── Fallback prix par département (médiane DVF 2023-2024) ───────────────────
const PRIX_DEPT = {
  "75":3300,"92":5800,"93":3800,"94":4800,          // Paris + PC
  "77":2800,"78":3400,"91":2700,"95":2900,           // GC IDF
  "06":4200,"13":2900,"69":3600,"31":2900,"33":3400, // grandes métropoles
  "34":2800,"38":2800,"44":3100,"59":2400,"67":3000, // autres métropoles
  "76":2400,"57":2100,"63":2000,"35":3000,"29":2300, // villes moyennes
  "04":2300,"05":2200,"48":1600,"15":1400,"23":1100, // rural/montagne (DVF 2024)
  "83":3400,"84":2700,"30":2300,"66":2200,"11":1900, // Sud-Méditerranée
  "971":2600,"972":2600,"973":1900,"974":2300,        // DOM
};

function getPrixFallback(dep) {
  if (!dep) return Math.round(2200 * 1.15);
  const prix = PRIX_DEPT[dep] || PRIX_DEPT[dep.substring(0, 2)] || 2200;
  return Math.round(prix * 1.15); // +15% prix neuf systématique
}

// ─── API Cadastre apicarto ────────────────────────────────────────────────────
async function getSurface(lat, lon) {
  const geom = encodeURIComponent(JSON.stringify({
    type: "Point",
    coordinates: [lon, lat]
  }));
  const url = `https://apicarto.ign.fr/api/cadastre/parcelle?geom=${geom}`;
  const data = await fetchJson(url);
  if (!data || !data.features || !data.features.length) return null;
  const props = data.features[0].properties;
  return {
    surface: props.contenance ? Math.round(props.contenance) : null,
    section: props.section,
    numero: props.numero,
    geometry: data.features[0].geometry || null,
    commune: props.nom_com || props.commune || props.nomcom,
    // Apicarto retourne dep_abs (ex:"04") + com_abs (ex:"152")
    // ou code_dep + code_com selon la version
    code_commune: props.code_dep && props.com_abs
      ? (props.code_dep + props.com_abs).padStart(5, '0')
      : props.code_com || props.codecomm || props.code_commune || null
  };
}

// ─── API BAN — géocodage adresse ──────────────────────────────────────────────
async function geocodeAdresse(adresse) {
  const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(adresse)}&limit=1`;
  const data = await fetchJson(url);
  if (!data || !data.features || !data.features.length) return null;
  const p = data.features[0].properties;
  const [lon, lat] = data.features[0].geometry.coordinates;
  return {
    lat, lon,
    label: p.label,
    postcode: p.postcode,
    city: p.city,
    dep: (p.postcode || "").substring(0, 2)
  };
}

// ─── Handler principal ────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  let { lat, lon, surface, adresse, insee } = req.query;

  // Géocodage si coords manquantes
  if ((!lat || !lon) && adresse) {
    const geo = await geocodeAdresse(adresse);
    if (!geo) return res.status(400).json({ error: "Adresse non trouvée" });
    lat = geo.lat; lon = geo.lon;
  }

  const latF = parseFloat(lat);
  const lonF = parseFloat(lon);
  if (isNaN(latF) || isNaN(lonF)) {
    return res.status(400).json({ error: "Coordonnées invalides" });
  }

  try {
    // ── Appels parallèles ──
    const [zoneResult, cadastreResult] = await Promise.all([
      getZonePLU(latF, lonF),
      getSurface(latF, lonF)
    ]);
    // DVF après cadastre pour avoir le code commune
    // Priorité: 1) insee BAN (passé par le frontend), 2) code cadastre, 3) null
    const codeCommune = insee || (cadastreResult && cadastreResult.code_commune) || null;
    const dvfResult = await getPrixMarche(latF, lonF, codeCommune);

    // ── Surface terrain ──
    let surfaceTerrain = parseFloat(surface) || 0;
    if (!surfaceTerrain && cadastreResult && cadastreResult.surface) {
      surfaceTerrain = cadastreResult.surface;
    }
    if (!surfaceTerrain) surfaceTerrain = 500; // fallback ultime

    // ── Zone PLU ──
    const codeZone = zoneResult ? zoneResult.code : null;
    const zoneKey = resolveZone(codeZone);
    const zoneInfo = ZONES_PLU[zoneKey] || ZONES_PLU["_fallback"];

    // ── Prix marché ──
    // Extraire le département depuis toutes les sources disponibles
    const dep = (codeCommune && codeCommune.length >= 2)
      ? codeCommune.substring(0, 2)
      : (insee && insee.length >= 2)
        ? insee.substring(0, 2)
        : (cadastreResult && cadastreResult.code_commune)
          ? cadastreResult.code_commune.substring(0, 2)
          : null;

    let prixMarche, dvfDetail;
    if (dvfResult && dvfResult.prix > 0) {
      prixMarche = dvfResult.prix;
      dvfDetail = dvfResult;
    } else {
      // Fallback département — toujours retourner un prix cohérent
      prixMarche = getPrixFallback(dep);
      dvfDetail = {
        prix: prixMarche,
        source: dep ? `Fallback département ${dep}` : "Fallback national",
        nb_transactions: 0,
        rayon_m: null
      };
    }
    
    // Garde-fou : prix minimum absolu 1500 €/m² (hors zones rurales profondes)
    if (prixMarche < 1500 && dep && !['15','19','23','48','09','12','43'].includes(dep)) {
      prixMarche = 1500;
      dvfDetail.prix = prixMarche;
      dvfDetail.source += ' (plancher 1500)';
    }

    // ── Zone réelle (Supabase, plu_zones) si extraite, sinon repli table statique ──
    const zoneReelle = await getZonePLUFromSupabase(codeCommune, codeZone);

    // ── Bilan promoteur ──
    const parcelGeometry = cadastreResult ? cadastreResult.geometry : null;
    const bilan = calculBilan(surfaceTerrain, zoneKey, prixMarche, zoneReelle, parcelGeometry);

    // ── Réponse ──
    return res.status(200).json({
      ok: true,
      coords: { lat: latF, lon: lonF },
      surface_terrain: Math.round(surfaceTerrain),
      cadastre: cadastreResult,
      zone_plu: {
        code: codeZone || "non identifiée",
        libelle: bilan.zone_label || zoneInfo.label,
        libelle_long: zoneResult ? zoneResult.libelle_long : null,
        key: zoneKey,
        source: zoneResult ? "GPU IGN apicarto" : "fallback",
        source_regles: bilan.source_zone || "table statique (générique)",
        source_emprise: bilan.source_emprise || null
      },
      prix_marche_m2: prixMarche,
      dvf: dvfDetail,
      bilan,
      // Détail complet pour email admin — reflète les valeurs réellement utilisées
      // (zone Supabase si extraite, sinon table statique), pas systématiquement le fallback.
      _admin: {
        etapes: [
          `1. Zone PLU : ${codeZone || "non identifiée"} → ${bilan.zone_label || zoneInfo.label}`,
          `   Source règles : ${bilan.source_zone || "table statique (générique)"} — Source zonage : ${zoneResult ? "GPU IGN apicarto.ign.fr" : "Fallback (GPU indisponible)"}`,
          `2. CES (emprise au sol max) : ${bilan.parametres ? (bilan.parametres.ces * 100).toFixed(0) : (zoneInfo.ces * 100).toFixed(0)}%`,
          `3. Surface terrain : ${Math.round(surfaceTerrain)} m²`,
          `4. Surface au sol = ${bilan.calcul ? bilan.calcul.surface_au_sol : Math.round(surfaceTerrain * zoneInfo.ces)} m² (${bilan.source_emprise || "CES seul"})`,
          `5. Hauteur acrotère PLU : ${bilan.parametres ? bilan.parametres.hauteur_acrotere : zoneInfo.hauteur} m → ${bilan.parametres ? bilan.parametres.nb_niveaux_calcules : Math.floor(zoneInfo.hauteur / 2.80)} niveaux (h/2.80m)`,
          `6. SHAB brute = ${bilan.calcul ? bilan.calcul.shab_brute : 0} m²`,
          `7. SHAB nette (×0.85, déduction parties communes) = ${bilan.calcul ? bilan.calcul.shab_nette : 0} m²`,
          `8. Prix neuf : ${prixMarche} €/m² (${dvfDetail ? dvfDetail.source : "fallback"})`,
          `9. CA TTC = ${bilan.calcul ? bilan.calcul.shab_nette : 0} m² × ${prixMarche} €/m² = ${bilan.calcul ? bilan.calcul.ca_ttc.toLocaleString("fr-FR") : 0} €`,
          `10. CA HT (÷1.20 TVA) = ${bilan.calcul ? bilan.calcul.ca_ht.toLocaleString("fr-FR") : 0} €`,
          `11. Coût travaux (1650 €/m²) = ${bilan.calcul ? bilan.calcul.cout_travaux.toLocaleString("fr-FR") : 0} €`,
          `12. Archi/BET (8% travaux) = ${bilan.calcul ? bilan.calcul.cout_archi_bet.toLocaleString("fr-FR") : 0} €`,
          `13. Commercialisation (5% CA TTC) = ${bilan.calcul ? bilan.calcul.cout_commercialisation.toLocaleString("fr-FR") : 0} €`,
          `14. Frais financiers (4% CA TTC) = ${bilan.calcul ? bilan.calcul.cout_financier.toLocaleString("fr-FR") : 0} €`,
          `15. Marge promoteur (20% CA TTC) = ${bilan.calcul ? bilan.calcul.marge_promoteur.toLocaleString("fr-FR") : 0} €`,
          `16. Charge foncière résiduelle = ${bilan.calcul ? bilan.calcul.charge_fonciere.toLocaleString("fr-FR") : 0} € (ratio CF/CA: ${bilan.calcul ? bilan.calcul.ratio_cf_ca_pct : 0}%)`,
          `17. Fourchette: ${bilan.valeur_terrain ? bilan.valeur_terrain.low.toLocaleString("fr-FR") : 0} – ${bilan.valeur_terrain ? bilan.valeur_terrain.high.toLocaleString("fr-FR") : 0} €`
        ]
      }
    });

  } catch (err) {
    console.error("[plu.js] Erreur:", err);
    return res.status(500).json({ error: "Erreur serveur", detail: err.message });
  }
};
