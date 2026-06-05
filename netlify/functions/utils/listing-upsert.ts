import { type NormalizedListingInput } from './sources';
import { buildAddressKey, buildListingHash } from './sources/normalize';
import { supabaseAdmin } from './supabase';

interface ListingWriteRow {
  source: string;
  source_listing_id: string | null;
  source_property_id: string | null;
  listing_url: string;
  listing_url_hash: string;
  identity_url_hash: string;
  address_key: string | null;
  image_url: string | null;
  title: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  rent_price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  allows_pets: boolean | null;
  has_fence: boolean | null;
  available_date: string | null;
  sqft: number | null;
  description_text: string | null;
  management_company: string | null;
  landlord_name: string | null;
  photo_count: number | null;
  tags: string[] | null;
  listing_details: unknown;
  fees: unknown;
  popularity: unknown;
  raw_snippet: string | null;
  raw_payload: unknown;
  status: string;
  last_seen_at: string;
  sources: string[];
}

interface ExistingListingRow extends ListingWriteRow {
  id: string;
}

interface ListingResultRow {
  id: string;
  source: string;
  listing_url_hash: string;
  rent_price: number | null;
  allows_pets: boolean | null;
  has_fence: boolean | null;
  status: string;
}

function toUpsertRow(listing: NormalizedListingInput, seenAtIso: string): ListingWriteRow {
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
    last_seen_at: seenAtIso,
    sources: [listing.source]
  };
}

interface UpsertListingsOptions {
  targetListId?: string | null;
}

function mergeSources(existingSources: string[] | null | undefined, source: string): string[] {
  const merged = new Set<string>();
  for (const item of existingSources ?? []) {
    if (typeof item === 'string' && item.trim().length > 0) {
      merged.add(item.trim().toLowerCase());
    }
  }
  if (source.trim().length > 0) {
    merged.add(source.trim().toLowerCase());
  }
  return [...merged].sort();
}

function preferIncoming<T>(incoming: T | null, current: T | null): T | null {
  return incoming !== null ? incoming : current;
}

function mergeIntoCanonical(existing: ExistingListingRow, incoming: ListingWriteRow): ListingWriteRow {
  return {
    ...existing,
    source: existing.source,
    source_listing_id: existing.source_listing_id,
    source_property_id: existing.source_property_id,
    listing_url: existing.listing_url,
    listing_url_hash: existing.listing_url_hash,
    identity_url_hash: existing.identity_url_hash,
    image_url: preferIncoming(incoming.image_url, existing.image_url),
    title: preferIncoming(incoming.title, existing.title),
    address: preferIncoming(incoming.address, existing.address),
    city: preferIncoming(incoming.city, existing.city),
    state: preferIncoming(incoming.state, existing.state),
    zip: preferIncoming(incoming.zip, existing.zip),
    rent_price: preferIncoming(incoming.rent_price, existing.rent_price),
    bedrooms: preferIncoming(incoming.bedrooms, existing.bedrooms),
    bathrooms: preferIncoming(incoming.bathrooms, existing.bathrooms),
    allows_pets: preferIncoming(incoming.allows_pets, existing.allows_pets),
    has_fence: preferIncoming(incoming.has_fence, existing.has_fence),
    available_date: preferIncoming(incoming.available_date, existing.available_date),
    sqft: preferIncoming(incoming.sqft, existing.sqft),
    description_text: preferIncoming(incoming.description_text, existing.description_text),
    management_company: preferIncoming(incoming.management_company, existing.management_company),
    landlord_name: preferIncoming(incoming.landlord_name, existing.landlord_name),
    photo_count: preferIncoming(incoming.photo_count, existing.photo_count),
    tags: preferIncoming(incoming.tags, existing.tags),
    listing_details: incoming.listing_details ?? existing.listing_details,
    fees: incoming.fees ?? existing.fees,
    popularity: incoming.popularity ?? existing.popularity,
    raw_snippet: preferIncoming(incoming.raw_snippet, existing.raw_snippet),
    raw_payload: incoming.raw_payload ?? existing.raw_payload,
    status: 'active',
    last_seen_at: incoming.last_seen_at,
    sources: mergeSources(existing.sources, incoming.source)
  };
}

function toResultRow(row: ExistingListingRow): ListingResultRow {
  return {
    id: row.id,
    source: row.source,
    listing_url_hash: row.listing_url_hash,
    rent_price: row.rent_price,
    allows_pets: row.allows_pets,
    has_fence: row.has_fence,
    status: row.status
  };
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
  const sourceValues = [...new Set(upsertRows.map((row) => row.source))] as string[];
  const listingHashValues = [...new Set(upsertRows.map((row) => row.listing_url_hash))] as string[];
  const incomingByConflictKey = new Map(upsertRows.map((row) => [`${row.source}:${row.listing_url_hash}`, row]));
  const existingListingByConflictKey = new Map<string, ExistingListingRow>();
  const previousRentByListingId = new Map<string, number | null>();

  if (sourceValues.length > 0 && listingHashValues.length > 0) {
    const existingResult = await supabaseAdmin
      .from('rental_listings')
      .select(
        'id, source, source_listing_id, source_property_id, listing_url, listing_url_hash, identity_url_hash, address_key, image_url, title, address, city, state, zip, rent_price, bedrooms, bathrooms, allows_pets, has_fence, available_date, sqft, description_text, management_company, landlord_name, photo_count, tags, listing_details, fees, popularity, raw_snippet, raw_payload, status, last_seen_at, sources'
      )
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
        !Array.isArray(row.sources) ||
        !incomingByConflictKey.has(`${row.source}:${row.listing_url_hash}`)
      ) {
        continue;
      }
      existingListingByConflictKey.set(`${row.source}:${row.listing_url_hash}`, row as ExistingListingRow);
      previousRentByListingId.set(row.id, typeof row.rent_price === 'number' ? row.rent_price : null);
    }
  }

  const addressKeysForCrossSourceMatch = [
    ...new Set(
      upsertRows
        .filter((row) => !existingListingByConflictKey.has(`${row.source}:${row.listing_url_hash}`))
        .map((row) => row.address_key)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    )
  ];
  const canonicalByAddressKey = new Map<string, ExistingListingRow>();
  if (addressKeysForCrossSourceMatch.length > 0) {
    const addressResult = await supabaseAdmin
      .from('rental_listings')
      .select(
        'id, source, source_listing_id, source_property_id, listing_url, listing_url_hash, identity_url_hash, address_key, image_url, title, address, city, state, zip, rent_price, bedrooms, bathrooms, allows_pets, has_fence, available_date, sqft, description_text, management_company, landlord_name, photo_count, tags, listing_details, fees, popularity, raw_snippet, raw_payload, status, last_seen_at, sources'
      )
      .eq('status', 'active')
      .in('address_key', addressKeysForCrossSourceMatch)
      .order('updated_at', { ascending: false })
      .limit(Math.max(addressKeysForCrossSourceMatch.length * 8, 200));

    if (addressResult.error) {
      throw addressResult.error;
    }

    for (const row of addressResult.data ?? []) {
      if (
        typeof row.id !== 'string' ||
        typeof row.address_key !== 'string' ||
        typeof row.source !== 'string' ||
        typeof row.listing_url_hash !== 'string' ||
        !Array.isArray(row.sources) ||
        canonicalByAddressKey.has(row.address_key)
      ) {
        continue;
      }

      const existingKey = `${row.source}:${row.listing_url_hash}`;
      if (incomingByConflictKey.has(existingKey)) {
        continue;
      }

      const typedRow = row as ExistingListingRow;
      canonicalByAddressKey.set(row.address_key, typedRow);
      previousRentByListingId.set(row.id, typeof row.rent_price === 'number' ? row.rent_price : null);
    }
  }

  const rowsForUpsert: ListingWriteRow[] = [];
  const rowsForCanonicalUpdate = new Map<string, ExistingListingRow>();
  const draftByAddressKey = new Map<string, ListingWriteRow>();

  for (const row of upsertRows) {
    const conflictKey = `${row.source}:${row.listing_url_hash}`;
    const existingConflict = existingListingByConflictKey.get(conflictKey);
    if (existingConflict) {
      rowsForUpsert.push({
        ...row,
        sources: mergeSources(existingConflict.sources, row.source)
      });
      continue;
    }

    const addressKey = row.address_key;
    if (addressKey && canonicalByAddressKey.has(addressKey)) {
      const existingCanonical = rowsForCanonicalUpdate.get(canonicalByAddressKey.get(addressKey)!.id) ?? canonicalByAddressKey.get(addressKey)!;
      const merged = {
        ...canonicalByAddressKey.get(addressKey)!,
        ...mergeIntoCanonical(existingCanonical, row)
      };
      rowsForCanonicalUpdate.set(merged.id, merged);
      canonicalByAddressKey.set(addressKey, merged);
      continue;
    }

    if (addressKey && draftByAddressKey.has(addressKey)) {
      const draft = draftByAddressKey.get(addressKey)!;
      draftByAddressKey.set(addressKey, {
        ...draft,
        image_url: preferIncoming(row.image_url, draft.image_url),
        title: preferIncoming(row.title, draft.title),
        address: preferIncoming(row.address, draft.address),
        city: preferIncoming(row.city, draft.city),
        state: preferIncoming(row.state, draft.state),
        zip: preferIncoming(row.zip, draft.zip),
        rent_price: preferIncoming(row.rent_price, draft.rent_price),
        bedrooms: preferIncoming(row.bedrooms, draft.bedrooms),
        bathrooms: preferIncoming(row.bathrooms, draft.bathrooms),
        allows_pets: preferIncoming(row.allows_pets, draft.allows_pets),
        has_fence: preferIncoming(row.has_fence, draft.has_fence),
        available_date: preferIncoming(row.available_date, draft.available_date),
        sqft: preferIncoming(row.sqft, draft.sqft),
        description_text: preferIncoming(row.description_text, draft.description_text),
        management_company: preferIncoming(row.management_company, draft.management_company),
        landlord_name: preferIncoming(row.landlord_name, draft.landlord_name),
        photo_count: preferIncoming(row.photo_count, draft.photo_count),
        tags: preferIncoming(row.tags, draft.tags),
        listing_details: row.listing_details ?? draft.listing_details,
        fees: row.fees ?? draft.fees,
        popularity: row.popularity ?? draft.popularity,
        raw_snippet: preferIncoming(row.raw_snippet, draft.raw_snippet),
        raw_payload: row.raw_payload ?? draft.raw_payload,
        last_seen_at: row.last_seen_at,
        sources: mergeSources(draft.sources, row.source)
      });
      continue;
    }

    if (addressKey) {
      draftByAddressKey.set(addressKey, row);
      continue;
    }

    rowsForUpsert.push(row);
  }

  for (const draftRow of draftByAddressKey.values()) {
    rowsForUpsert.push(draftRow);
  }

  const resultRows: ListingResultRow[] = [];
  if (rowsForUpsert.length > 0) {
    const upsertResult = await supabaseAdmin
      .from('rental_listings')
      .upsert(rowsForUpsert, { onConflict: 'source,listing_url_hash' })
      .select('id, source, listing_url_hash, rent_price, allows_pets, has_fence, status');

    if (upsertResult.error) {
      throw upsertResult.error;
    }

    resultRows.push(...((upsertResult.data ?? []) as ListingResultRow[]));
  }

  for (const canonicalRow of rowsForCanonicalUpdate.values()) {
    const { id, ...updatePayload } = canonicalRow;
    const updateResult = await supabaseAdmin
      .from('rental_listings')
      .update(updatePayload)
      .eq('id', id)
      .select('id, source, listing_url_hash, rent_price, allows_pets, has_fence, status')
      .single();

    if (updateResult.error) {
      throw updateResult.error;
    }

    if (updateResult.data) {
      resultRows.push(updateResult.data as ListingResultRow);
    } else {
      resultRows.push(toResultRow(canonicalRow));
    }
  }

  const updatedRows = resultRows;
  if (updatedRows.length > 0) {
    const snapshotRows = updatedRows
      .map((row) => {
        if (typeof row.id !== 'string') {
          return null;
        }

        const previousPrice = previousRentByListingId.get(row.id);
        const currentPrice = typeof row.rent_price === 'number' ? row.rent_price : null;
        if (currentPrice === null) {
          return null;
        }

        const isNewListing = previousPrice === undefined;
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
      const membershipRows = [...new Set(updatedRows.map((row) => row.id))].map((listingId) => ({
        list_id: options.targetListId,
        listing_id: listingId
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
