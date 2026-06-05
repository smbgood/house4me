alter table public.rental_listings
  add column if not exists is_crossed_off boolean not null default false;

create index if not exists rental_listings_visible_last_seen_idx
  on public.rental_listings (last_seen_at desc)
  where status = 'active' and is_crossed_off = false;
