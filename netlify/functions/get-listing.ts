import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

import { verifyGoogleRefreshToken } from './auth';
import { defaultHeaders, optionsResponse } from './utils/cors';

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

interface PriceHistoryPoint {
  rent_price: number;
  captured_at: string;
}

function collapsePriceHistory(
  snapshots: Array<{ rent_price: number | null; captured_at: string }>
): PriceHistoryPoint[] {
  const collapsed: PriceHistoryPoint[] = [];

  for (const snapshot of snapshots) {
    if (typeof snapshot.rent_price !== 'number' || snapshot.captured_at.length === 0) {
      continue;
    }

    const previous = collapsed[collapsed.length - 1];
    if (previous && previous.rent_price === snapshot.rent_price) {
      continue;
    }

    collapsed.push({
      rent_price: snapshot.rent_price,
      captured_at: snapshot.captured_at
    });
  }

  return collapsed;
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

  const listingId = event.queryStringParameters?.['id']?.trim();
  if (!listingId) {
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Query parameter id is required.' })
    };
  }

  let verification;
  try {
    verification = await verifyGoogleRefreshToken(refreshToken);
  } catch (error) {
    console.error('Failed to verify Google token for get-listing:', error);
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
  const googleEmail = verification.email?.trim().toLowerCase();
  if (!googleEmail) {
    return {
      statusCode: 401,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Unauthorized.' })
    };
  }

  const supabaseAdmin = getSupabaseAdmin();
  const listingResult = await supabaseAdmin
    .from('rental_listings')
    .select(
      'id, source, source_listing_id, source_property_id, listing_url, image_url, title, address, city, state, zip, rent_price, bedrooms, bathrooms, allows_pets, has_fence, available_date, sqft, description_text, management_company, landlord_name, photo_count, tags, listing_details, fees, popularity, raw_snippet, raw_payload, is_crossed_off, status, last_seen_at, created_at, updated_at'
    )
    .eq('id', listingId)
    .maybeSingle();

  if (listingResult.error) {
    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: listingResult.error.message })
    };
  }

  if (!listingResult.data) {
    return {
      statusCode: 404,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Listing not found.' })
    };
  }

  const snapshotResult = await supabaseAdmin
    .from('rental_listing_snapshots')
    .select('rent_price, captured_at')
    .eq('listing_id', listingId)
    .order('captured_at', { ascending: true })
    .limit(1000);
  if (snapshotResult.error) {
    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: snapshotResult.error.message })
    };
  }

  const priceHistory = collapsePriceHistory(
    (snapshotResult.data ?? []).map((row) => ({
      rent_price: typeof row.rent_price === 'number' ? row.rent_price : null,
      captured_at: typeof row.captured_at === 'string' ? row.captured_at : ''
    }))
  );

  const likeResult = await supabaseAdmin
    .from('user_liked_listings')
    .select('listing_id')
    .eq('google_email', googleEmail)
    .eq('listing_id', listingId)
    .maybeSingle();
  if (likeResult.error) {
    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: likeResult.error.message })
    };
  }

  const listingWithLike = {
    ...listingResult.data,
    is_liked: Boolean(likeResult.data),
    price_history: priceHistory
  };

  return {
    statusCode: 200,
    headers: defaultHeaders,
    body: JSON.stringify({ listing: listingWithLike })
  };
};
