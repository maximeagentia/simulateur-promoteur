// api/_lib/anthropic-extraction.js — extraction PLU par zone, avec citation
// vérifiée contre le texte source (pas de confiance aveugle dans le JSON renvoyé).
const Anthropic = require('@anthropic-ai/sdk');

// Haiku par défaut — choix explicite du porteur du projet (budget quasi nul),
// remplaçable via env var si la précision d'extraction s'avère insuffisante.
const MODEL = process.env.PLU_EXTRACTION_MODEL || 'claude-haiku-4-5';

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic();
}

const PROMPT_ZONE = (zoneCode) => `Tu analyses un règlement de PLU (Plan Local d'Urbanisme) français.

Trouve les dispositions applicables à la zone "${zoneCode}" et donne, quand le règlement les précise :
- CES (coefficient d'emprise au sol maximal, en proportion 0-1)
- hauteur maximale autorisée (en mètres)
- recul minimal par rapport à la voie/emprise publique (en mètres)
- recul minimal par rapport aux limites séparatives (en mètres)

Pour chaque valeur que tu donnes, cite le passage exact du règlement qui la justifie.
Si une règle n'est pas fixée par un chiffre simple (ex: "recul égal à la hauteur du bâtiment"),
laisse le champ JSON correspondant à null plutôt que d'inventer un nombre.

Termine ta réponse par un bloc JSON unique, exactement dans ce format :
\`\`\`json
{"ces": 0.35, "hauteur_m": 9, "recul_facade_m": 5, "recul_limites_m": 3}
\`\`\`
Utilise null pour toute valeur non déterminable avec certitude à partir du texte.`;

function extraireBlocJson(texte) {
  const m = texte.match(/```json\s*([\s\S]*?)```/i) || texte.match(/\{[\s\S]*"ces"[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[1] || m[0]); } catch { return null; }
}

// Variantes de formatage pour chercher une valeur numérique dans le texte cité
// (le règlement peut écrire "35 %", "0,35", "35%", "9 m", "9,00 mètres"...).
function variantesTexte(valeur, estRatio) {
  const variantes = new Set();
  if (estRatio) {
    const pct = Math.round(valeur * 100);
    variantes.add(String(pct));
    variantes.add(pct + '%');
    variantes.add(pct + ' %');
  }
  variantes.add(String(valeur));
  variantes.add(String(valeur).replace('.', ','));
  return Array.from(variantes);
}

function champVerifie(valeur, estRatio, texteGrounding) {
  if (valeur == null) return true; // rien à vérifier pour un champ non renseigné
  return variantesTexte(valeur, estRatio).some(v => texteGrounding.includes(v));
}

// texteReglement : texte du règlement (PDF pré-extrait via pdf-parse côté
// appelant — évite d'envoyer le PDF en pages-image à Claude, bien plus cher
// en tokens qu'un document texte pour un règlement qui est presque toujours
// du texte natif, pas un scan).
//
// cache_control sur le bloc document : traiterCommune() appelle cette
// fonction jusqu'à MAX_ZONES_PAR_COMMUNE fois avec le même texteReglement —
// sans cache, on repaierait le plein tarif à chaque zone pour le même
// contenu. Avec, seule la première zone paie l'écriture en cache ; les
// suivantes lisent le cache à ~10% du prix (tant qu'elles s'enchaînent dans
// la fenêtre de cache, ce qui est le cas ici, appels synchrones en boucle).
//
// Retourne { ces, hauteur_m, recul_facade_m, recul_limites_m, citation,
//            citation_verifiee, statut } ou null si l'appel échoue.
async function extraireReglesZone(texteReglement, zoneCode) {
  const client = getClient();
  if (!client) return null;

  let resp;
  try {
    resp = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'text', media_type: 'text/plain', data: texteReglement },
            citations: { enabled: true },
            cache_control: { type: 'ephemeral' },
          },
          { type: 'text', text: PROMPT_ZONE(zoneCode) },
        ],
      }],
    });
  } catch (err) {
    return { statut: 'echec', erreur: err.message };
  }

  const blocsTexte = resp.content.filter(b => b.type === 'text');
  const texteComplet = blocsTexte.map(b => b.text).join('\n');
  const grounding = blocsTexte
    .flatMap(b => (b.citations || []).map(c => c.cited_text || ''))
    .join(' \n ');

  const json = extraireBlocJson(texteComplet);
  if (!json) return { statut: 'echec', erreur: 'Pas de bloc JSON exploitable dans la réponse' };

  const champs = {
    ces: [json.ces, true],
    hauteur_m: [json.hauteur_m, false],
    recul_facade_m: [json.recul_facade_m, false],
    recul_limites_m: [json.recul_limites_m, false],
  };
  const tousVerifies = Object.values(champs).every(
    ([valeur, estRatio]) => champVerifie(valeur, estRatio, grounding)
  );

  return {
    ces: json.ces ?? null,
    hauteur_m: json.hauteur_m ?? null,
    recul_facade_m: json.recul_facade_m ?? null,
    recul_limites_m: json.recul_limites_m ?? null,
    citation: grounding.slice(0, 2000) || null,
    citation_verifiee: tousVerifies && grounding.length > 0,
    // "valide" seulement si chaque champ chiffré est retrouvé dans le texte cité —
    // sinon "a_valider" : la donnée reste utilisable mais signalée pour revue humaine.
    statut: (tousVerifies && grounding.length > 0) ? 'valide' : 'a_valider',
  };
}

module.exports = { extraireReglesZone, MODEL };
