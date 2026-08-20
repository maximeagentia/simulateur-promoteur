-- Suivi au niveau document (pas zone) pour la veille par changement :
-- un document GPU (= un PLU/PLUi) contient plusieurs zones, mais le
-- changement se détecte une fois par document, pas une fois par zone.

create table if not exists plu_documents (
  id uuid primary key default gen_random_uuid(),

  insee_commune text not null unique,
  partition text,                    -- ex: "DU_75056"
  gpu_doc_id text,                   -- gpu_doc_id du GPU (md5), sert de clé d'archive
  document_name text,                -- ex: "75056_PLU_20260616"
  legal_status text,                 -- APPROVED | PARTIALLY_ANNULLED | ANNULLED | HISTORICAL

  upload_date timestamptz,           -- uploadDate renvoyé par le GPU au dernier traitement
  last_checked_at timestamptz,       -- dernier passage du cron de veille, même sans changement
  last_extracted_at timestamptz,     -- dernière extraction réussie (upload_date a changé)

  extraction_status text not null default 'a_traiter'
    check (extraction_status in ('a_traiter', 'en_cours', 'ok', 'echec')),
  derniere_erreur text
);

create index if not exists idx_plu_documents_a_traiter
  on plu_documents (last_checked_at nulls first);

comment on table plu_documents is
  'Etat de veille par commune. Le cron compare upload_date à la valeur stockée '
  'avant de relancer une extraction complète (toutes zones) sur ce document.';
