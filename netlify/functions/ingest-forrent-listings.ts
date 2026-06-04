import type { Handler } from '@netlify/functions';

import { defaultHeaders, optionsResponse } from './utils/cors';
import { upsertListingsAndSnapshots } from './utils/listing-upsert';
import { inferFenceValue, inferPetsValue, parseNumber, parseRent, toAbsoluteUrl } from './utils/sources/normalize';
import { type NormalizedListingInput } from './utils/sources/types';
import { supabaseAdmin } from './utils/supabase';

const FORRENT_BASE_URL = 'https://www.forrent.com';

interface IngestBody {
  listings?: unknown;
}

function getBearerToken(headers: Record<string, string | undefined>): string | null {
  const value = headers['authorization'] ?? headers['Authorization'];
  if (!value) {
    return null;
  }
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function normalizeIncomingListing(input: unknown): NormalizedListingInput | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const candidate = input as {
    listingUrl?: unknown;
    sourceListingId?: unknown;
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

  const startedAt = new Date().toISOString();
  const runInsert = await supabaseAdmin
    .from('source_sync_runs')
    .insert({
      source: 'forrent',
      status: 'started',
      started_at: startedAt,
      metadata: {
        mode: 'manual-addon',
        submittedCount: parsedBody.listings.length
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
    const upserted = await upsertListingsAndSnapshots(acceptedListings);

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
        upserted
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
