-- DVF national ingéré une fois (script scripts/ingest-dvf.js, à relancer au
-- rythme de publication officiel du DGFiP, ~2×/an), interrogé en géométrie
-- réelle au lieu d'un appel live à un miroir tiers (api.cquest.org) à chaque
-- simulation. Remplace aussi le fallback PRIX_DEPT (30 départements sur 101).

create extension if not exists postgis;

create table if not exists dvf_transactions (
  id_mutation text not null,
  date_mutation date not null,
  nature_mutation text,
  valeur_fonciere numeric,
  type_local text not null,          -- 'Maison' | 'Appartement' (seuls types ingérés)
  surface_reelle_bati numeric,
  code_commune text not null,
  code_departement text not null,
  longitude double precision not null,
  latitude double precision not null,
  geog geography(Point, 4326) generated always as (
    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
  ) stored,

  -- Une transaction peut porter sur plusieurs parcelles (plusieurs lignes
  -- dans le CSV source pour le même id_mutation) ; on ne garde qu'une ligne
  -- par (id_mutation, type_local) à l'ingestion pour ne pas compter une
  -- vente plusieurs fois dans le prix moyen.
  primary key (id_mutation, type_local)
);

create index if not exists idx_dvf_geog on dvf_transactions using gist (geog);
create index if not exists idx_dvf_departement on dvf_transactions (code_departement);
create index if not exists idx_dvf_commune on dvf_transactions (code_commune);

-- Requête spatiale : transactions d'un type donné dans un rayon, 5 dernières
-- années. La logique de rayon progressif / moyenne tronquée reste côté JS
-- (api/_lib/dvf.js) pour rester la même que le fallback cquest — cette
-- fonction ne fait que la partie qui doit tourner en base (le filtre
-- géographique), pas les statistiques.
create or replace function dvf_transactions_dans_rayon(
  p_lat double precision,
  p_lon double precision,
  p_rayon_m integer,
  p_type_local text
) returns table (
  valeur_fonciere numeric,
  surface_reelle_bati numeric,
  date_mutation date
) language sql stable as $$
  select valeur_fonciere, surface_reelle_bati, date_mutation
  from dvf_transactions
  where type_local = p_type_local
    and date_mutation > (current_date - interval '5 years')
    and ST_DWithin(geog, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography, p_rayon_m)
$$;

comment on table dvf_transactions is
  'DVF national, ingéré par lots (scripts/ingest-dvf.js), une ligne par '
  '(id_mutation, type_local) pour éviter le double comptage des mutations '
  'multi-parcelles.';
