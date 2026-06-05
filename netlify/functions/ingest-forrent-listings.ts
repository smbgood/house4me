import type { Handler } from '@netlify/functions';

import { defaultHeaders, optionsResponse } from './utils/cors';
import { upsertListingsAndSnapshots } from './utils/listing-upsert';
import { MAIN_LIST_SLUG, resolveListingListByIdOrSlug } from './utils/listing-lists';
import { inferFenceValue, inferPetsValue, parseNumber, parseRent, toAbsoluteUrl } from './utils/sources/normalize';
import { type NormalizedListingInput } from './utils/sources/types';
import { supabaseAdmin } from './utils/supabase';

const FORRENT_BASE_URL = 'https://www.forrent.com';

interface IngestBody {
  listings?: unknown;
  listId?: unknown;
  listSlug?: unknown;
}

function parseDateOnly(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})$/);
  return match ? match[1] : undefined;
}

function parseTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const tags = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
  return tags.length > 0 ? tags : undefined;
}

function getBearerToken(headers: Record<string, string | undefined>): string | null {
  const value = headers['authorization'] ?? headers['Authorization'];
  if (!value) {
    return null;
  }
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function summarizeForRentAmenityDiagnostics(listings: NormalizedListingInput[]): {
  withListingDetails: number;
  withAmenityTags: number;
  withoutAmenityTags: number;
  samples: Array<{
    listingUrl: string;
    listingDetailRowCount: number;
    amenityTagCount: number | null;
    extractionStrategy: string | null;
    embeddedProfileFound: boolean | null;
  }>;
} {
  let withListingDetails = 0;
  let withAmenityTags = 0;

  for (const listing of listings) {
    const detailRows = Array.isArray(listing.listingDetails) ? listing.listingDetails : [];
    if (detailRows.length > 0) {
      withListingDetails += 1;
    }

    const rawPayload =
      listing.rawPayload && typeof listing.rawPayload === 'object'
        ? (listing.rawPayload as Record<string, unknown>)
        : null;
    const debug =
      rawPayload?.amenityExtractionDebug && typeof rawPayload.amenityExtractionDebug === 'object'
        ? (rawPayload.amenityExtractionDebug as Record<string, unknown>)
        : null;
    const amenityTagCount = typeof debug?.totalAmenityTags === 'number' ? debug.totalAmenityTags : null;
    const tagCount = amenityTagCount ?? (Array.isArray(listing.tags) ? listing.tags.length : 0);
    if (tagCount > 0) {
      withAmenityTags += 1;
    }
  }

  const samples = listings.slice(0, 5).map((listing) => {
    const detailRows = Array.isArray(listing.listingDetails) ? listing.listingDetails : [];
    const rawPayload =
      listing.rawPayload && typeof listing.rawPayload === 'object'
        ? (listing.rawPayload as Record<string, unknown>)
        : null;
    const debug =
      rawPayload?.amenityExtractionDebug && typeof rawPayload.amenityExtractionDebug === 'object'
        ? (rawPayload.amenityExtractionDebug as Record<string, unknown>)
        : null;

    return {
      listingUrl: listing.listingUrl,
      listingDetailRowCount: detailRows.length,
      amenityTagCount: typeof debug?.totalAmenityTags === 'number' ? debug.totalAmenityTags : null,
      extractionStrategy: typeof debug?.extractionStrategy === 'string' ? debug.extractionStrategy : null,
      embeddedProfileFound: typeof debug?.embeddedProfileFound === 'boolean' ? debug.embeddedProfileFound : null
    };
  });

  return {
    withListingDetails,
    withAmenityTags,
    withoutAmenityTags: listings.length - withAmenityTags,
    samples
  };
}

function normalizeIncomingListing(input: unknown): NormalizedListingInput | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const candidate = input as {
    listingUrl?: unknown;
    sourceListingId?: unknown;
    sourcePropertyId?: unknown;
    imageUrl?: unknown;
    title?: unknown;
    address?: unknown;
    city?: unknown;
    state?: unknown;
    zip?: unknown;
    rentPrice?: unknown;
    bedrooms?: unknown;
    bathrooms?: unknown;
    allowsPets?: unknown;
    hasFence?: unknown;
    availableDate?: unknown;
    sqft?: unknown;
    descriptionText?: unknown;
    managementCompany?: unknown;
    landlordName?: unknown;
    photoCount?: unknown;
    tags?: unknown;
    listingDetails?: unknown;
    fees?: unknown;
    popularity?: unknown;
    rawSnippet?: unknown;
    rawPayload?: unknown;
  };

  const listingUrl = toAbsoluteUrl(
    typeof candidate.listingUrl === 'string' ? candidate.listingUrl : undefined,
    FORRENT_BASE_URL
  );
  if (!listingUrl) {
    return null;
  }

  const sourceText = [
    typeof candidate.title === 'string' ? candidate.title : '',
    typeof candidate.rawSnippet === 'string' ? candidate.rawSnippet : ''
  ]
    .join(' ')
    .trim();

  return {
    source: 'forrent',
    sourceListingId: typeof candidate.sourceListingId === 'string' ? candidate.sourceListingId : undefined,
    sourcePropertyId: typeof candidate.sourcePropertyId === 'string' ? candidate.sourcePropertyId : undefined,
    listingUrl,
    imageUrl: toAbsoluteUrl(typeof candidate.imageUrl === 'string' ? candidate.imageUrl : undefined, FORRENT_BASE_URL),
    title: typeof candidate.title === 'string' ? candidate.title : undefined,
    address: typeof candidate.address === 'string' ? candidate.address : undefined,
    city: typeof candidate.city === 'string' ? candidate.city : undefined,
    state: typeof candidate.state === 'string' ? candidate.state : undefined,
    zip: typeof candidate.zip === 'string' ? candidate.zip : undefined,
    rentPrice: parseRent(candidate.rentPrice),
    bedrooms: parseNumber(candidate.bedrooms),
    bathrooms: parseNumber(candidate.bathrooms),
    allowsPets: typeof candidate.allowsPets === 'boolean' ? candidate.allowsPets : inferPetsValue(sourceText),
    hasFence: typeof candidate.hasFence === 'boolean' ? candidate.hasFence : inferFenceValue(sourceText),
    availableDate: parseDateOnly(candidate.availableDate),
    sqft: parseNumber(candidate.sqft),
    descriptionText: typeof candidate.descriptionText === 'string' ? candidate.descriptionText : undefined,
    managementCompany: typeof candidate.managementCompany === 'string' ? candidate.managementCompany : undefined,
    landlordName: typeof candidate.landlordName === 'string' ? candidate.landlordName : undefined,
    photoCount: parseNumber(candidate.photoCount),
    tags: parseTags(candidate.tags),
    listingDetails: candidate.listingDetails ?? undefined,
    fees: candidate.fees ?? undefined,
    popularity: candidate.popularity ?? undefined,
    rawSnippet: typeof candidate.rawSnippet === 'string' ? candidate.rawSnippet : undefined,
    rawPayload: candidate.rawPayload ?? input
  };
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return optionsResponse;
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Method not allowed.' })
    };
  }

  const configuredToken = process.env['FORRENT_INGEST_TOKEN'];
  if (!configuredToken) {
    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Missing FORRENT_INGEST_TOKEN environment variable.' })
    };
  }

  const token = getBearerToken(event.headers);
  if (!token || token !== configuredToken) {
    return {
      statusCode: 401,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Unauthorized.' })
    };
  }

  let parsedBody: IngestBody;
  try {
    parsedBody = event.body ? (JSON.parse(event.body) as IngestBody) : {};
  } catch {
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Invalid JSON body.' })
    };
  }

  if (!Array.isArray(parsedBody.listings)) {
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Request body must include a listings array.' })
    };
  }

  const listId = typeof parsedBody.listId === 'string' ? parsedBody.listId.trim() : '';
  const listSlug = typeof parsedBody.listSlug === 'string' ? parsedBody.listSlug.trim().toLowerCase() : '';
  let selectedList = null;
  if (listId || listSlug) {
    selectedList = await resolveListingListByIdOrSlug({
      listId: listId || undefined,
      listSlug: listSlug || undefined
    });
    if (!selectedList) {
      return {
        statusCode: 400,
        headers: defaultHeaders,
        body: JSON.stringify({ error: 'Invalid listId or listSlug.' })
      };
    }
  }

  const targetListId = selectedList && selectedList.slug !== MAIN_LIST_SLUG ? selectedList.id : null;

  const startedAt = new Date().toISOString();
  const runInsert = await supabaseAdmin
    .from('source_sync_runs')
    .insert({
      source: 'forrent',
      status: 'started',
      started_at: startedAt,
      metadata: {
        mode: 'manual-addon',
        submittedCount: parsedBody.listings.length,
        targetListSlug: selectedList?.slug ?? MAIN_LIST_SLUG
      }
    })
    .select('id')
    .single();

  const runId = runInsert.data?.id;
  const normalized = parsedBody.listings
    .map((listing) => normalizeIncomingListing(listing))
    .filter((listing): listing is NormalizedListingInput => Boolean(listing));

  const deduped = new Map<string, NormalizedListingInput>();
  for (const listing of normalized) {
    deduped.set(listing.listingUrl, listing);
  }

  try {
    const acceptedListings = [...deduped.values()];
    const amenityDiagnostics = summarizeForRentAmenityDiagnostics(acceptedListings);
    console.info(
      JSON.stringify({
        event: 'forrent-ingest-amenity-diagnostics',
        received: parsedBody.listings.length,
        accepted: acceptedListings.length,
        ...amenityDiagnostics
      })
    );

    const upserted = await upsertListingsAndSnapshots(acceptedListings, startedAt, { targetListId });

    await supabaseAdmin
      .from('source_sync_runs')
      .update({
        status: 'success',
        completed_at: new Date().toISOString(),
        listings_found: acceptedListings.length,
        listings_upserted: upserted
      })
      .eq('id', runId);

    return {
      statusCode: 200,
      headers: defaultHeaders,
      body: JSON.stringify({
        source: 'forrent',
        received: parsedBody.listings.length,
        accepted: acceptedListings.length,
        rejected: parsedBody.listings.length - acceptedListings.length,
        upserted,
        imported_to_list: selectedList?.slug ?? MAIN_LIST_SLUG,
        amenityDiagnostics
      })
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown ingest error';
    await supabaseAdmin
      .from('source_sync_runs')
      .update({
        status: 'error',
        completed_at: new Date().toISOString(),
        error_summary: errorMessage
      })
      .eq('id', runId);

    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: errorMessage })
    };
  }
};
