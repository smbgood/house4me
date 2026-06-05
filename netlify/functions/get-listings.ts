import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

import { verifyGoogleRefreshToken } from './auth';
import { defaultHeaders, optionsResponse } from './utils/cors';

function parseBooleanFilter(value?: string): boolean | undefined {
  if (!value) {
    return undefined;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return undefined;
}

function parseIntegerFilter(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBearerToken(headers: Record<string, string | undefined>): string | null {
  const authHeader = headers['authorization'] ?? headers['Authorization'];
  if (!authHeader) {
    return null;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function getSupabaseAdmin() {
  const supabaseUrl = process.env['SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return optionsResponse;
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Method not allowed.' })
    };
  }

  const refreshToken = parseBearerToken(event.headers);
  if (!refreshToken) {
    return {
      statusCode: 401,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Unauthorized.' })
    };
  }

  let verification;
  try {
    verification = await verifyGoogleRefreshToken(refreshToken);
  } catch (error) {
    console.error('Failed to verify Google token for get-listings:', error);
    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Auth configuration error.' })
    };
  }

  if (!verification.valid) {
    return {
      statusCode: 401,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Unauthorized.' })
    };
  }

  const supabaseAdmin = getSupabaseAdmin();

  const source = event.queryStringParameters?.['source'];
  const pets = parseBooleanFilter(event.queryStringParameters?.['pets']);
  const fence = parseBooleanFilter(event.queryStringParameters?.['fence']);
  const minRent = parseIntegerFilter(event.queryStringParameters?.['minRent']);
  const maxRent = parseIntegerFilter(event.queryStringParameters?.['maxRent']);
  const q = event.queryStringParameters?.['q']?.trim().toLowerCase();

  let query = supabaseAdmin
    .from('rental_listings')
    .select(
      'id, source, listing_url, image_url, title, address, city, state, zip, rent_price, bedrooms, bathrooms, allows_pets, has_fence, available_date, sqft, management_company, landlord_name, photo_count, status, last_seen_at'
    )
    .eq('status', 'active')
    .order('last_seen_at', { ascending: false })
    .limit(250);

  if (source) {
    query = query.eq('source', source);
  }
  if (pets !== undefined) {
    query = query.eq('allows_pets', pets);
  }
  if (fence !== undefined) {
    query = query.eq('has_fence', fence);
  }
  if (minRent !== undefined) {
    query = query.gte('rent_price', minRent);
  }
  if (maxRent !== undefined) {
    query = query.lte('rent_price', maxRent);
  }

  const listingsResult = await query;
  if (listingsResult.error) {
    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: listingsResult.error.message })
    };
  }

  const filteredListings = (listingsResult.data ?? []).filter((listing) => {
    if (!q) {
      return true;
    }
    const haystack = `${listing.title ?? ''} ${listing.address ?? ''} ${listing.city ?? ''} ${listing.state ?? ''}`.toLowerCase();
    return haystack.includes(q);
  });

  const syncStatusResult = await supabaseAdmin
    .from('source_sync_runs')
    .select('source, status, completed_at, listings_found, listings_upserted, error_summary')
    .order('started_at', { ascending: false })
    .limit(20);

  return {
    statusCode: 200,
    headers: defaultHeaders,
    body: JSON.stringify({
      listings: filteredListings,
      syncStatus: syncStatusResult.data ?? []
    })
  };
};
