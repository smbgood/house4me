alter table public.rental_listings
  add column if not exists sources text[] not null default '{}'::text[];

update public.rental_listings
set sources = case
  when source is null or btrim(source) = '' then '{}'::text[]
  else array[source]
end
where coalesce(array_length(sources, 1), 0) = 0;

create index if not exists rental_listings_sources_gin_idx
  on public.rental_listings
  using gin (sources);
