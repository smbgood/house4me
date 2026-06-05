import { type NormalizedListingInput } from './sources';
import { buildListingHash } from './sources/normalize';
import { supabaseAdmin } from './supabase';

function toUpsertRow(listing: NormalizedListingInput, seenAtIso: string) {
  return {
    source: listing.source,
    source_listing_id: listing.sourceListingId ?? null,
    source_property_id: listing.sourcePropertyId ?? null,
    listing_url: listing.listingUrl,
    listing_url_hash: buildListingHash(listing.listingUrl),
    image_url: listing.imageUrl ?? null,
    title: listing.title ?? null,
    address: listing.address ?? null,
    city: listing.city ?? null,
    state: listing.state ?? null,
    zip: listing.zip ?? null,
    rent_price: listing.rentPrice ?? null,
    bedrooms: listing.bedrooms ?? null,
    bathrooms: listing.bathrooms ?? null,
    allows_pets: listing.allowsPets ?? null,
    has_fence: listing.hasFence ?? null,
    available_date: listing.availableDate ?? null,
    sqft: listing.sqft ?? null,
    description_text: listing.descriptionText ?? null,
    management_company: listing.managementCompany ?? null,
    landlord_name: listing.landlordName ?? null,
    photo_count: listing.photoCount ?? null,
    tags: listing.tags ?? null,
    listing_details: listing.listingDetails ?? null,
    fees: listing.fees ?? null,
    popularity: listing.popularity ?? null,
    raw_snippet: listing.rawSnippet ?? null,
    raw_payload: listing.rawPayload ?? null,
    status: 'active',
    last_seen_at: seenAtIso
  };
}

export async function upsertListingsAndSnapshots(
  listings: NormalizedListingInput[],
  seenAtIso = new Date().toISOString()
): Promise<number> {
  if (listings.length === 0) {
    return 0;
  }

  const upsertRows = listings.map((listing) => toUpsertRow(listing, seenAtIso));
  const upsertResult = await supabaseAdmin
    .from('rental_listings')
    .upsert(upsertRows, { onConflict: 'source,listing_url_hash' })
    .select('id, rent_price, allows_pets, has_fence, status');

  if (upsertResult.error) {
    throw upsertResult.error;
  }

  const updatedRows = upsertResult.data ?? [];
  if (updatedRows.length > 0) {
    const snapshotRows = updatedRows.map((row) => ({
      listing_id: row.id,
      rent_price: row.rent_price,
      allows_pets: row.allows_pets,
      has_fence: row.has_fence,
      status: row.status
    }));
    const snapshotResult = await supabaseAdmin.from('rental_listing_snapshots').insert(snapshotRows);
    if (snapshotResult.error) {
      throw snapshotResult.error;
    }
  }

  return updatedRows.length;
}
