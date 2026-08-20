// api/_lib/geometrie.js — emprise constructible par géométrie réelle plutôt que CES seul
const buffer = require('@turf/buffer').default;
const area = require('@turf/area').default;

// Érode le polygone cadastral des reculs réels (façade + limites séparatives,
// moyenne simple — pas de distinction du côté voie pour cette V1, cf. dossier
// de synthèse §division parcellaire) et renvoie la surface résiduelle en m².
// Retourne null si le calcul n'est pas possible (géométrie absente/invalide) :
// dans ce cas l'appelant doit se replier sur surfaceTerrain × CES.
function surfaceApresReculs(polygonGeoJSON, reculFacadeM, reculLimitesM) {
  if (!polygonGeoJSON || !polygonGeoJSON.type) return null;

  const reculs = [reculFacadeM, reculLimitesM].filter(v => typeof v === 'number' && v > 0);
  if (!reculs.length) return null;
  const reculMoyen = reculs.reduce((a, b) => a + b, 0) / reculs.length;

  try {
    const erode = buffer(polygonGeoJSON, -reculMoyen, { units: 'meters' });
    if (!erode || !erode.geometry) return 0; // parcelle entièrement rongée par les reculs
    return Math.round(area(erode));
  } catch {
    return null;
  }
}

module.exports = { surfaceApresReculs };
