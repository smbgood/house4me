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

  let verification;
  try {
    verification = await verifyGoogleRefreshToken(refreshToken);
  } catch (error) {
    console.error('Failed to verify Google token for get-liked-listings:', error);
    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Auth configuration error.' })
    };
  }

  const googleEmail = verification.email?.trim().toLowerCase();
  if (!verification.valid || !googleEmail) {
    return {
      statusCode: 401,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Unauthorized.' })
    };
  }

  const supabaseAdmin = getSupabaseAdmin();
  const likesResult = await supabaseAdmin
    .from('user_liked_listings')
    .select('listing_id, created_at')
    .eq('google_email', googleEmail)
    .order('created_at', { ascending: false })
    .limit(250);
  if (likesResult.error) {
    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: likesResult.error.message })
    };
  }

  const likedRows = likesResult.data ?? [];
  const listingIds = likedRows.map((row) => row.listing_id).filter((id): id is string => typeof id === 'string');
  if (listingIds.length === 0) {
    return {
      statusCode: 200,
      headers: defaultHeaders,
      body: JSON.stringify({ listings: [] })
    };
  }

  const listingsResult = await supabaseAdmin
    .from('rental_listings')
    .select(
      'id, source, listing_url, image_url, title, address, city, state, zip, rent_price, bedrooms, bathrooms, allows_pets, has_fence, available_date, sqft, management_company, landlord_name, photo_count, is_crossed_off, status, last_seen_at'
    )
    .eq('status', 'active')
    .eq('is_crossed_off', false)
    .in('id', listingIds);
  if (listingsResult.error) {
    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: listingsResult.error.message })
    };
  }

  const listingById = new Map((listingsResult.data ?? []).map((listing) => [listing.id, listing]));
  const orderedListings = listingIds
    .map((id) => listingById.get(id))
    .filter((listing): listing is NonNullable<typeof listing> => Boolean(listing))
    .map((listing) => ({ ...listing, is_liked: true }));

  return {
    statusCode: 200,
    headers: defaultHeaders,
    body: JSON.stringify({ listings: orderedListings })
  };
};
