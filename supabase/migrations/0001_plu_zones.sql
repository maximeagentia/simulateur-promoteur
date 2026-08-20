-- PLU_Cache : règles d'urbanisme réelles extraites par commune × zone,
-- pour remplacer la table statique ZONES_PLU (calibrée sur un seul PLUi)
-- par les vraies règles de chaque PLU, avec traçabilité de la source.
--
-- A appliquer manuellement (dashboard Supabase > SQL editor, ou `supabase db push`).

create extension if not exists pgcrypto;

create table if not exists plu_zones (
  id uuid primary key default gen_random_uuid(),

  -- Identification de la zone
  insee_commune text not null,
  commune_nom text,
  zone_code text not null,          -- code brut du GPU, ex: "UCa", "N", "1AUb"
  partition text,                   -- identifiant GPU du document (ex: "DU_75056")
  gpu_doc_id text,                  -- gpu_doc_id du GPU (md5)

  -- Règles extraites
  zone_label text,
  ces numeric,                      -- emprise au sol max (0-1)
  hauteur_m numeric,                -- hauteur max autorisée (m)
  recul_facade_m numeric,           -- recul par rapport à la voie
  recul_limites_m numeric,          -- recul par rapport aux limites séparatives
  stationnement_note text,          -- note libre, pas encore structuré

  -- Traçabilité / vérification (obligatoire avant d'utiliser la donnée en confiance)
  citation text,                    -- extrait exact du règlement source, pour vérification
  citation_verifiee boolean not null default false,
  statut text not null default 'a_valider'
    check (statut in ('a_valider', 'valide', 'echec')),

  -- Fraîcheur (veille par changement, pas par péremption fixe)
  document_upload_date timestamptz, -- uploadDate du document GPU au moment de l'extraction
  date_extraction timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (insee_commune, zone_code)
);

create index if not exists idx_plu_zones_lookup
  on plu_zones (insee_commune, zone_code);

comment on table plu_zones is
  'Règles PLU extraites par commune x zone, remplace la table statique ZONES_PLU. '
  'statut=a_valider tant que la citation n''a pas été confirmée par un humain ; '
  'toujours utilisable pour le calcul (citation_verifiee garantit juste la cohérence texte<->chiffre, '
  'pas une revue humaine).';
