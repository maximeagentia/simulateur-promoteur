// api/cron/extract-plu.js — veille + extraction PLU, appelé par le cron Vercel
// (voir vercel.json). Traite un petit lot par passage : conçu pour tourner
// 1×/jour et converger progressivement, pas pour tout traiter d'un coup
// (limites d'exécution Vercel + coût API maîtrisé).

const {
  getDocumentsATraiter,
  upsertDocument,
  upsertZonePLU,
  amorcerCommunesCibles,
} = require('../_lib/supabase');
const { getDocumentPourCommune, getDetailsDocument, getZonesPourCommune } = require('../_lib/geo-commune');
const { extraireReglesZone } = require('../_lib/anthropic-extraction');
const { getCommunesCibles } = require('../_lib/plu-communes-cibles');

const BATCH_COMMUNES = parseInt(process.env.PLU_CRON_BATCH || '2', 10);
const MAX_ZONES_PAR_COMMUNE = parseInt(process.env.PLU_CRON_MAX_ZONES || '10', 10);

async function fetchPdfBase64(url) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.toString('base64');
  } catch { return null; }
  finally { clearTimeout(tid); }
}

async function traiterCommune(doc) {
  const insee = doc.insee_commune;
  const resume = { insee, statut: 'inchange' };

  const docGpu = await getDocumentPourCommune(insee);
  if (!docGpu || !docGpu.gpu_doc_id) {
    await upsertDocument(insee, { last_checked_at: new Date().toISOString(), extraction_status: 'echec', derniere_erreur: 'Document GPU introuvable' });
    return { ...resume, statut: 'document_introuvable' };
  }

  const details = await getDetailsDocument(docGpu.gpu_doc_id);
  if (!details) {
    await upsertDocument(insee, { last_checked_at: new Date().toISOString(), extraction_status: 'echec', derniere_erreur: 'Détails document inaccessibles' });
    return { ...resume, statut: 'details_inaccessibles' };
  }

  // Ne jamais extraire un règlement annulé ou seulement partiellement en vigueur.
  if (details.legalStatus && details.legalStatus !== 'APPROVED') {
    await upsertDocument(insee, {
      partition: docGpu.partition, gpu_doc_id: docGpu.gpu_doc_id, document_name: docGpu.document_name,
      legal_status: details.legalStatus, last_checked_at: new Date().toISOString(),
      extraction_status: 'echec', derniere_erreur: `legalStatus=${details.legalStatus}, extraction ignorée`,
    });
    return { ...resume, statut: 'legal_status_non_approuve', legalStatus: details.legalStatus };
  }

  // Veille par changement : rien à refaire si l'upload n'a pas changé depuis le dernier passage.
  const uploadDate = details.uploadDate || null;
  if (doc.upload_date && uploadDate && new Date(uploadDate).getTime() === new Date(doc.upload_date).getTime()) {
    await upsertDocument(insee, { last_checked_at: new Date().toISOString() });
    return resume;
  }

  const writingMaterials = details.writingMaterials || {};
  const pdfUrl = Object.values(writingMaterials)[0];
  if (!pdfUrl) {
    await upsertDocument(insee, { last_checked_at: new Date().toISOString(), extraction_status: 'echec', derniere_erreur: 'Aucun fichier de règlement (writingMaterials vide)' });
    return { ...resume, statut: 'pas_de_pdf' };
  }

  const pdfBase64 = await fetchPdfBase64(pdfUrl);
  if (!pdfBase64) {
    await upsertDocument(insee, { last_checked_at: new Date().toISOString(), extraction_status: 'echec', derniere_erreur: 'Échec téléchargement PDF' });
    return { ...resume, statut: 'pdf_inaccessible' };
  }

  const zones = (await getZonesPourCommune(insee)).slice(0, MAX_ZONES_PAR_COMMUNE);
  if (!zones.length) {
    await upsertDocument(insee, { last_checked_at: new Date().toISOString(), extraction_status: 'echec', derniere_erreur: 'Aucune zone trouvée pour cette commune' });
    return { ...resume, statut: 'pas_de_zones' };
  }

  const resultatsZones = [];
  for (const zoneCode of zones) {
    const extraction = await extraireReglesZone(pdfBase64, zoneCode);
    if (!extraction) continue; // ANTHROPIC_API_KEY absent -> pas d'extraction possible
    await upsertZonePLU(insee, zoneCode, {
      commune_nom: doc.commune_nom || null,
      partition: docGpu.partition,
      gpu_doc_id: docGpu.gpu_doc_id,
      ces: extraction.ces,
      hauteur_m: extraction.hauteur_m,
      recul_facade_m: extraction.recul_facade_m,
      recul_limites_m: extraction.recul_limites_m,
      citation: extraction.citation,
      citation_verifiee: extraction.citation_verifiee,
      statut: extraction.statut,
      document_upload_date: uploadDate,
      date_extraction: new Date().toISOString(),
    });
    resultatsZones.push({ zone: zoneCode, statut: extraction.statut });
  }

  await upsertDocument(insee, {
    partition: docGpu.partition,
    gpu_doc_id: docGpu.gpu_doc_id,
    document_name: docGpu.document_name,
    legal_status: details.legalStatus || null,
    upload_date: uploadDate,
    last_checked_at: new Date().toISOString(),
    last_extracted_at: new Date().toISOString(),
    extraction_status: resultatsZones.length ? 'ok' : 'echec',
    derniere_erreur: resultatsZones.length ? null : 'ANTHROPIC_API_KEY non configurée',
  });

  return { ...resume, statut: 'extrait', zones: resultatsZones };
}

module.exports = async function handler(req, res) {
  // Vercel envoie Authorization: Bearer <CRON_SECRET> sur les invocations cron
  // quand CRON_SECRET est configuré — protège l'endpoint des appels publics
  // (chaque exécution coûte des appels API DVF/IGN et potentiellement Anthropic).
  if (process.env.CRON_SECRET) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const communesCibles = await getCommunesCibles();
    await amorcerCommunesCibles(communesCibles);

    const documents = await getDocumentsATraiter(BATCH_COMMUNES);
    const resultats = [];
    for (const doc of documents) {
      try {
        resultats.push(await traiterCommune(doc));
      } catch (err) {
        await upsertDocument(doc.insee_commune, {
          last_checked_at: new Date().toISOString(),
          extraction_status: 'echec',
          derniere_erreur: err.message,
        });
        resultats.push({ insee: doc.insee_commune, statut: 'erreur', erreur: err.message });
      }
    }

    return res.status(200).json({ ok: true, traites: resultats.length, resultats });
  } catch (err) {
    console.error('[cron/extract-plu] Erreur:', err);
    return res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
};
