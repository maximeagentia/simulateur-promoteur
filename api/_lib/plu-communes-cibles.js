// api/_lib/plu-communes-cibles.js
//
// Liste de départ, PAS basée sur du trafic réel — je n'ai pas pu accéder à la
// base Airtable du projet depuis cette session (seule une base sans rapport
// avec ce projet était visible via le connecteur Airtable disponible ici).
//
// A remplacer dès que possible par une requête sur les vraies simulations
// Airtable (champ Adresse -> code INSEE), pour prioriser les communes qui
// génèrent réellement des leads plutôt que cette liste générique de grandes
// villes. Ces codes INSEE n'ont pas été vérifiés en direct dans cette session
// (à l'exception de 75056, testé plus tôt sur l'API GPU) — à contrôler avant
// un premier run en production.
const COMMUNES_CIBLES_PLACEHOLDER = [
  { insee: "75056", nom: "Paris" },
  { insee: "69123", nom: "Lyon" },
  { insee: "13055", nom: "Marseille" },
  { insee: "31555", nom: "Toulouse" },
  { insee: "33063", nom: "Bordeaux" },
  { insee: "44109", nom: "Nantes" },
  { insee: "59350", nom: "Lille" },
  { insee: "35238", nom: "Rennes" },
  { insee: "67482", nom: "Strasbourg" },
  { insee: "06088", nom: "Nice" },
  { insee: "34172", nom: "Montpellier" },
];

// Idéalement : lire depuis Airtable (table des simulations, champ Adresse
// -> code INSEE via geocodage), avec repli sur la liste statique si Airtable
// n'est pas accessible. Reste à brancher (nécessite un token Airtable
// configuré et un mapping adresse -> insee déjà stocké côté simulation).
async function getCommunesCibles(limite) {
  return COMMUNES_CIBLES_PLACEHOLDER.slice(0, limite || COMMUNES_CIBLES_PLACEHOLDER.length);
}

module.exports = { getCommunesCibles, COMMUNES_CIBLES_PLACEHOLDER };
