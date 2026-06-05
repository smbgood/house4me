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
      'too_close_to_neighbors'
    )
  );
