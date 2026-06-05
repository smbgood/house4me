alter table public.rental_listings
  add column if not exists identity_url_hash text,
  add column if not exists address_key text;

update public.rental_listings
set
  identity_url_hash = coalesce(
    identity_url_hash,
    encode(digest(coalesce(listing_url, ''), 'sha256'), 'hex')
  ),
  address_key = coalesce(
    address_key,
    nullif(
      concat_ws(
        '|',
        nullif(lower(trim(coalesce(address, ''))), ''),
        nullif(lower(trim(coalesce(city, ''))), ''),
        nullif(lower(trim(coalesce(state, ''))), ''),
        nullif(lower(trim(coalesce(zip, ''))), '')
      ),
      ''
    )
  );

create index if not exists rental_listings_identity_url_hash_idx
  on public.rental_listings (identity_url_hash);

create index if not exists rental_listings_address_key_idx
  on public.rental_listings (address_key);

create table if not exists public.rental_listing_lists (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rental_listing_lists_slug_check check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table if not exists public.rental_listing_list_memberships (
  list_id uuid not null references public.rental_listing_lists (id) on delete cascade,
  listing_id uuid not null references public.rental_listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (list_id, listing_id)
);

create index if not exists rental_listing_list_memberships_listing_id_idx
  on public.rental_listing_list_memberships (listing_id);

insert into public.rental_listing_lists (slug, name, is_system)
values ('main', 'Main', true)
on conflict (slug) do update
set
  name = excluded.name,
  is_system = excluded.is_system;

alter table public.rental_listing_lists enable row level security;
alter table public.rental_listing_list_memberships enable row level security;

drop trigger if exists rental_listing_lists_set_updated_at on public.rental_listing_lists;
create trigger rental_listing_lists_set_updated_at
before update on public.rental_listing_lists
for each row execute function public.set_updated_at();
