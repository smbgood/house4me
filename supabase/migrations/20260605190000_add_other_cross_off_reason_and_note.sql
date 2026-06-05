alter table public.rental_listings
  add column if not exists cross_off_note text;

alter table public.rental_listings
  drop constraint if exists rental_listings_cross_off_reason_check;

alter table public.rental_listings
  add constraint rental_listings_cross_off_reason_check
  check (
    cross_off_reason is null
    or cross_off_reason in (
      'did_not_match_requirements',
      'did_not_like_area',
      'did_not_like_house',
      'no_fence',
      'two_story',
      'no_tub',
      'too_close_to_neighbors',
      'other'
    )
  );

alter table public.rental_listings
  drop constraint if exists rental_listings_cross_off_note_check;

alter table public.rental_listings
  add constraint rental_listings_cross_off_note_check
  check (
    cross_off_reason is distinct from 'other'
    or nullif(btrim(cross_off_note), '') is not null
  );
