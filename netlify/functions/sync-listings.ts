import type { Handler } from '@netlify/functions';

import { defaultHeaders, optionsResponse } from './utils/cors';
import { upsertListingsAndSnapshots } from './utils/listing-upsert';
import { sourceAdapters, type SearchConfig } from './utils/sources';
import { supabaseAdmin } from './utils/supabase';

interface SyncSummary {
  source: string;
  status: 'success' | 'error';
  found: number;
  upserted: number;
  error?: string;
}

function getSearchConfig(): SearchConfig {
  const city = process.env['RENTAL_SEARCH_CITY'];
  const state = process.env['RENTAL_SEARCH_STATE'];

  if (!city || !state) {
    throw new Error('RENTAL_SEARCH_CITY and RENTAL_SEARCH_STATE are required.');
  }

  const zip = process.env['RENTAL_SEARCH_ZIP'];
  const radiusMiles = process.env['RENTAL_SEARCH_RADIUS_MILES']
    ? Number.parseInt(process.env['RENTAL_SEARCH_RADIUS_MILES'], 10)
    : undefined;
  const maxPrice = process.env['RENTAL_SEARCH_MAX_PRICE']
    ? Number.parseInt(process.env['RENTAL_SEARCH_MAX_PRICE'], 10)
    : undefined;

  return {
    city,
    state,
    zip,
    radiusMiles: Number.isFinite(radiusMiles) ? radiusMiles : undefined,
    maxPrice: Number.isFinite(maxPrice) ? maxPrice : undefined
  };
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return optionsResponse;
  }

  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Method not allowed.' })
    };
  }

  let searchConfig: SearchConfig;
  try {
    searchConfig = getSearchConfig();
  } catch (error) {
    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid search config' })
    };
  }

  const summaries: SyncSummary[] = [];

  for (const adapter of sourceAdapters) {
    const startedAt = new Date().toISOString();
    const runInsert = await supabaseAdmin
      .from('source_sync_runs')
      .insert({
        source: adapter.source,
        status: 'started',
        started_at: startedAt,
        metadata: {
          city: searchConfig.city,
          state: searchConfig.state,
          zip: searchConfig.zip ?? null,
          radiusMiles: searchConfig.radiusMiles ?? null,
          maxPrice: searchConfig.maxPrice ?? null
        }
      })
      .select('id')
      .single();

    const runId = runInsert.data?.id;

    try {
      const listings = await adapter.fetchListings(searchConfig);
      const filtered = searchConfig.maxPrice
        ? listings.filter((listing) => !listing.rentPrice || listing.rentPrice <= searchConfig.maxPrice!)
        : listings;
      const upserted = await upsertListingsAndSnapshots(filtered);

      await supabaseAdmin
        .from('source_sync_runs')
        .update({
          status: 'success',
          completed_at: new Date().toISOString(),
          listings_found: listings.length,
          listings_upserted: upserted
        })
        .eq('id', runId);

      summaries.push({
        source: adapter.source,
        status: 'success',
        found: listings.length,
        upserted
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown sync error';
      await supabaseAdmin
        .from('source_sync_runs')
        .update({
          status: 'error',
          completed_at: new Date().toISOString(),
          error_summary: errorMessage
        })
        .eq('id', runId);

      summaries.push({
        source: adapter.source,
        status: 'error',
        found: 0,
        upserted: 0,
        error: errorMessage
      });
    }
  }

  return {
    statusCode: 200,
    headers: defaultHeaders,
    body: JSON.stringify({
      syncedAt: new Date().toISOString(),
      summaries
    })
  };
};
