#!/usr/bin/env node
// scripts/ingest-dvf.js — ingestion DVF nationale (geo-dvf, Etalab), à lancer
// manuellement/via CI, PAS un endpoint Vercel : volumétrie et durée
// incompatibles avec une fonction serverless (des millions de lignes au
// national, à relancer ~2×/an au rythme de publication du DGFiP).
//
// Usage :
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/ingest-dvf.js --departements 09,31,75 --annees 2024,2025
//
// Sans --departements : traite les 101 départements (script long, prévoir
// plusieurs heures et surveiller le quota Supabase). Sans --annees : 5
// dernières années.

const zlib = require('zlib');
const { parse } = require('csv-parse');
const { getSupabase } = require('../api/_lib/supabase');

const DEPARTEMENTS_TOUS = [
  ...Array.from({ length: 95 }, (_, i) => String(i + 1).padStart(2, '0')).filter(d => d !== '20'),
  '2A', '2B', '971', '972', '973', '974',
];

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (nom) => {
    const i = args.indexOf(`--${nom}`);
    return i >= 0 ? args[i + 1] : null;
  };
  const departements = (get('departements') || '').split(',').map(s => s.trim()).filter(Boolean);
  const anneeCourante = new Date().getFullYear();
  const annees = (get('annees') || '').split(',').map(s => s.trim()).filter(Boolean)
    .map(Number);
  return {
    departements: departements.length ? departements : DEPARTEMENTS_TOUS,
    annees: annees.length ? annees : [anneeCourante, anneeCourante - 1, anneeCourante - 2, anneeCourante - 3, anneeCourante - 4],
  };
}

async function telechargerEtParser(departement, annee) {
  const url = `https://files.data.gouv.fr/geo-dvf/latest/csv/${annee}/departements/${departement}.csv.gz`;
  const resp = await fetch(url);
  if (!resp.ok) {
    console.log(`  [${departement}/${annee}] indisponible (${resp.status}), ignoré`);
    return [];
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  const texte = zlib.gunzipSync(buf).toString('utf8');

  return new Promise((resolve, reject) => {
    const lignes = [];
    parse(texte, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) return reject(err);
      resolve(records);
    });
  });
}

// Une transaction (id_mutation) peut apparaître sur plusieurs lignes du CSV
// (plusieurs parcelles/natures de culture dans la même vente) : on ne garde
// qu'une ligne par (id_mutation, type_local) pour ne pas la compter deux fois.
function dedupliquerEtFiltrer(records, departement) {
  const vus = new Map(); // clé "id_mutation|type_local" -> ligne retenue
  for (const r of records) {
    if (r.type_local !== 'Maison' && r.type_local !== 'Appartement') continue;
    if (!r.longitude || !r.latitude || !r.valeur_fonciere) continue;
    const cle = `${r.id_mutation}|${r.type_local}`;
    if (vus.has(cle)) continue;
    vus.set(cle, {
      id_mutation: r.id_mutation,
      date_mutation: r.date_mutation,
      nature_mutation: r.nature_mutation,
      valeur_fonciere: parseFloat(r.valeur_fonciere) || null,
      type_local: r.type_local,
      surface_reelle_bati: parseFloat(r.surface_reelle_bati) || null,
      code_commune: r.code_commune,
      code_departement: departement,
      longitude: parseFloat(r.longitude),
      latitude: parseFloat(r.latitude),
    });
  }
  return Array.from(vus.values());
}

async function upsertParLots(sb, lignes, taille) {
  let insere = 0;
  for (let i = 0; i < lignes.length; i += taille) {
    const lot = lignes.slice(i, i + taille);
    const { error } = await sb.from('dvf_transactions').upsert(lot, { onConflict: 'id_mutation,type_local' });
    if (error) {
      console.error(`  Erreur upsert lot ${i}-${i + lot.length}:`, error.message);
      continue;
    }
    insere += lot.length;
  }
  return insere;
}

async function main() {
  const sb = getSupabase();
  if (!sb) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY non configurés — rien à faire.');
    process.exit(1);
  }

  const { departements, annees } = parseArgs();
  console.log(`Ingestion DVF : ${departements.length} départements × ${annees.length} années`);

  let totalInsere = 0;
  for (const dep of departements) {
    for (const annee of annees) {
      console.log(`[${dep}/${annee}] téléchargement...`);
      let records;
      try {
        records = await telechargerEtParser(dep, annee);
      } catch (err) {
        console.error(`  Erreur téléchargement/parsing:`, err.message);
        continue;
      }
      const lignes = dedupliquerEtFiltrer(records, dep);
      console.log(`  ${records.length} lignes brutes -> ${lignes.length} transactions logement dédupliquées`);
      const insere = await upsertParLots(sb, lignes, 500);
      totalInsere += insere;
      console.log(`  ${insere} lignes upsertées (total cumulé : ${totalInsere})`);
    }
  }

  console.log(`Terminé. ${totalInsere} transactions upsertées au total.`);
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { dedupliquerEtFiltrer, parseArgs };
