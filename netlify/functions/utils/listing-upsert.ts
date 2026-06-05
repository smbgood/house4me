import { type NormalizedListingInput } from './sources';
import { buildAddressKey, buildListingHash } from './sources/normalize';
import { supabaseAdmin } from './supabase';

function toUpsertRow(listing: NormalizedListingInput, seenAtIso: string) {
  return {
    source: listing.source,
    source_listing_id: listing.sourceListingId ?? null,
    source_property_id: listing.sourcePropertyId ?? null,
    listing_url: listing.listingUrl,
    listing_url_hash: buildListingHash(listing.listingUrl),
    identity_url_hash: buildListingHash(listing.listingUrl),
    address_key: buildAddressKey(listing.address, listing.city, listing.state, listing.zip),
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

interface UpsertListingsOptions {
  targetListId?: string | null;
}

export async function upsertListingsAndSnapshots(
  listings: NormalizedListingInput[],
  seenAtIso = new Date().toISOString(),
  options: UpsertListingsOptions = {}
): Promise<number> {
  if (listings.length === 0) {
    return 0;
  }

  const upsertRows = listings.map((listing) => toUpsertRow(listing, seenAtIso));
  const sourceValues = [...new Set(upsertRows.map((row) => row.source))];
  const listingHashValues = [...new Set(upsertRows.map((row) => row.listing_url_hash))];
  const incomingByConflictKey = new Map(upsertRows.map((row) => [`${row.source}:${row.listing_url_hash}`, row]));
  const existingListingByConflictKey = new Map<string, { id: string; rent_price: number | null }>();

  if (sourceValues.length > 0 && listingHashValues.length > 0) {
    const existingResult = await supabaseAdmin
      .from('rental_listings')
      .select('id, source, listing_url_hash, rent_price')
      .in('source', sourceValues)
      .in('listing_url_hash', listingHashValues)
      .limit(Math.max(listings.length * 4, 200));

    if (existingResult.error) {
      throw existingResult.error;
    }

    for (const row of existingResult.data ?? []) {
      if (
        typeof row.id !== 'string' ||
        typeof row.source !== 'string' ||
        typeof row.listing_url_hash !== 'string' ||
        !incomingByConflictKey.has(`${row.source}:${row.listing_url_hash}`)
      ) {
        continue;
      }
      existingListingByConflictKey.set(`${row.source}:${row.listing_url_hash}`, {
        id: row.id,
        rent_price: typeof row.rent_price === 'number' ? row.rent_price : null
      });
    }
  }

  const upsertResult = await supabaseAdmin
    .from('rental_listings')
    .upsert(upsertRows, { onConflict: 'source,listing_url_hash' })
    .select('id, source, listing_url_hash, rent_price, allows_pets, has_fence, status');

  if (upsertResult.error) {
    throw upsertResult.error;
  }

  const updatedRows = upsertResult.data ?? [];
  if (updatedRows.length > 0) {
    const snapshotRows = updatedRows
      .map((row) => {
        const conflictKey =
          typeof row.source === 'string' && typeof row.listing_url_hash === 'string'
            ? `${row.source}:${row.listing_url_hash}`
            : null;
        if (!conflictKey) {
          return null;
        }

        const previous = existingListingByConflictKey.get(conflictKey);
        const currentPrice = typeof row.rent_price === 'number' ? row.rent_price : null;
        if (currentPrice === null) {
          return null;
        }

        const isNewListing = !previous;
        const previousPrice = previous?.rent_price ?? null;
        const priceChanged = previousPrice !== currentPrice;
        if (!isNewListing && !priceChanged) {
          return null;
        }

        return {
          listing_id: row.id,
          rent_price: currentPrice,
          allows_pets: row.allows_pets,
          has_fence: row.has_fence,
          status: row.status,
          captured_at: seenAtIso
        };
      })
      .filter(
        (
          row
        ): row is {
          listing_id: string;
          rent_price: number;
          allows_pets: boolean | null;
          has_fence: boolean | null;
          status: string;
          captured_at: string;
        } => Boolean(row)
      );

    if (snapshotRows.length > 0) {
      const snapshotResult = await supabaseAdmin.from('rental_listing_snapshots').insert(snapshotRows);
      if (snapshotResult.error) {
        throw snapshotResult.error;
      }
    }

    if (options.targetListId) {
      const membershipRows = updatedRows.map((row) => ({
        list_id: options.targetListId,
        listing_id: row.id
      }));
      const membershipInsert = await supabaseAdmin
        .from('rental_listing_list_memberships')
        .upsert(membershipRows, { onConflict: 'list_id,listing_id', ignoreDuplicates: true });
      if (membershipInsert.error) {
        throw membershipInsert.error;
      }
    }
  }

  return updatedRows.length;
}
