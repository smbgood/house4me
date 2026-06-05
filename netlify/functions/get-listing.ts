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

  const supabaseAdmin = getSupabaseAdmin();
  const listingResult = await supabaseAdmin
    .from('rental_listings')
    .select(
      'id, source, source_listing_id, source_property_id, listing_url, image_url, title, address, city, state, zip, rent_price, bedrooms, bathrooms, allows_pets, has_fence, available_date, sqft, description_text, management_company, landlord_name, photo_count, tags, listing_details, fees, popularity, raw_snippet, raw_payload, status, last_seen_at, created_at, updated_at'
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

  return {
    statusCode: 200,
    headers: defaultHeaders,
    body: JSON.stringify({ listing: listingResult.data })
  };
};
