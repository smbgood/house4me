create table if not exists public.user_liked_listings (
  google_email text not null check (google_email <> ''),
  listing_id uuid not null references public.rental_listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (google_email, listing_id)
);

create index if not exists user_liked_listings_listing_id_idx
  on public.user_liked_listings (listing_id);

create index if not exists user_liked_listings_email_created_idx
  on public.user_liked_listings (google_email, created_at desc);

alter table public.user_liked_listings enable row level security;
