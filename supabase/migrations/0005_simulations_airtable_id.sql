-- Colonne de traçabilité pour la reprise ponctuelle de l'historique
-- Airtable vers simulations (voir scripts/backfill-airtable-simulations.js).
-- Unique + nullable : les nouvelles lignes créées par api/simulation.js
-- n'en ont pas, celles reprises d'Airtable permettent un ré-import
-- idempotent (upsert onConflict).
alter table simulations add column if not exists airtable_record_id text unique;
