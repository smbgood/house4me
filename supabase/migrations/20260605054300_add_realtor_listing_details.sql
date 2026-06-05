alter table public.rental_listings
  add column if not exists source_property_id text,
  add column if not exists available_date date,
  add column if not exists sqft integer,
  add column if not exists description_text text,
  add column if not exists management_company text,
  add column if not exists landlord_name text,
  add column if not exists photo_count integer,
  add column if not exists tags text[],
  add column if not exists listing_details jsonb,
  add column if not exists fees jsonb,
  add column if not exists popularity jsonb;

create index if not exists rental_listings_available_date_idx
  on public.rental_listings (available_date);

create index if not exists rental_listings_sqft_idx
  on public.rental_listings (sqft);
