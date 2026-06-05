alter table public.rental_listings
  add column if not exists cross_off_reason text,
  add column if not exists crossed_off_by text,
  add column if not exists crossed_off_at timestamptz;

alter table public.rental_listings
  drop constraint if exists rental_listings_cross_off_reason_check;

alter table public.rental_listings
  add constraint rental_listings_cross_off_reason_check
  check (
    cross_off_reason is null
    or cross_off_reason in (
      'did_not_match_requirements',
      'did_not_like_area',
      'did_not_like_house'
    )
  );
