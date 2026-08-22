-- Table simulations — remplace Airtable comme source de vérité pour le
-- dashboard admin et l'espace promoteur. Migré depuis Airtable
-- (scripts/migrate-airtable-simulations.js pour l'historique), écrit par
-- api/simulation.js pour toute nouvelle soumission du site.
--
-- Airtable reste utilisé en parallèle nulle part ici volontairement : une
-- seule source de vérité, moins de risque de désynchronisation entre les
-- deux vues (dashboard admin vs Airtable).

create table if not exists simulations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  type text not null default 'simulation' check (type in ('simulation', 'contact')),

  adresse text,
  insee_commune text,
  latitude double precision,
  longitude double precision,
  geog geography(Point, 4326) generated always as (
    case when latitude is not null and longitude is not null
      then ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
    end
  ) stored,

  surface_terrain numeric,
  surface_bati numeric,
  cadastre text,

  zone_plu_libelle text,
  zone_plu_code text,
  ces numeric,

  score integer,
  prix_marche_dvf numeric,
  ca_ttc numeric,
  charge_fonciere numeric,
  ratio_cf_ca numeric,
  marge_promo numeric,
  val_low numeric,
  val_high numeric,
  cout_travaux numeric,

  -- Renseignés seulement pour type='contact' (demande d'étude détaillée).
  nom text,
  prenom text,
  email text,
  tel text
);

create index if not exists idx_simulations_geog on simulations using gist (geog);
create index if not exists idx_simulations_created_at on simulations (created_at desc);
create index if not exists idx_simulations_email on simulations (email) where email is not null;

-- Comptage par rayon pour le teaser d'acquisition promoteur — n'expose
-- qu'un agrégat, jamais les coordonnées ou données personnelles des leads
-- individuels (même principe que dvf_transactions_dans_rayon).
create or replace function simulations_dans_rayon(
  p_lat double precision,
  p_lon double precision,
  p_rayon_m integer
) returns integer language sql stable as $$
  select count(*)::int
  from simulations
  where geog is not null
    and ST_DWithin(geog, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography, p_rayon_m)
$$;

comment on table simulations is
  'Une ligne par simulation ou demande de contact sur le site. Source de '
  'vérité unique pour le dashboard admin et le futur espace promoteur — '
  'Airtable n''est plus alimenté après la migration.';
