create extension if not exists pgcrypto;

create table if not exists public.rental_listings (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_listing_id text,
  listing_url text not null,
  listing_url_hash text not null,
  image_url text,
  title text,
  address text,
  city text,
  state text,
  zip text,
  rent_price integer,
  bedrooms numeric(4, 1),
  bathrooms numeric(4, 1),
  allows_pets boolean,
  has_fence boolean,
  status text not null default 'active',
  raw_snippet text,
  raw_payload jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rental_listings_source_url_hash_unique unique (source, listing_url_hash)
);

create index if not exists rental_listings_source_idx on public.rental_listings (source);
create index if not exists rental_listings_last_seen_idx on public.rental_listings (last_seen_at desc);
create index if not exists rental_listings_rent_price_idx on public.rental_listings (rent_price);
create index if not exists rental_listings_allows_pets_idx on public.rental_listings (allows_pets);
create index if not exists rental_listings_has_fence_idx on public.rental_listings (has_fence);

create table if not exists public.rental_listing_snapshots (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.rental_listings (id) on delete cascade,
  rent_price integer,
  allows_pets boolean,
  has_fence boolean,
  status text not null default 'active',
  captured_at timestamptz not null default now()
);

create index if not exists rental_listing_snapshots_listing_id_idx
  on public.rental_listing_snapshots (listing_id, captured_at desc);

create table if not exists public.source_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  status text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  listings_found integer not null default 0,
  listings_upserted integer not null default 0,
  error_summary text,
  metadata jsonb
);

create index if not exists source_sync_runs_source_started_idx
  on public.source_sync_runs (source, started_at desc);

alter table public.rental_listings enable row level security;
alter table public.rental_listing_snapshots enable row level security;
alter table public.source_sync_runs enable row level security;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists rental_listings_set_updated_at on public.rental_listings;
create trigger rental_listings_set_updated_at
before update on public.rental_listings
for each row execute function public.set_updated_at();
