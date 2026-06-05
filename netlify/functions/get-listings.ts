import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

import { verifyGoogleRefreshToken } from './auth';
import { defaultHeaders, optionsResponse } from './utils/cors';
import { MAIN_LIST_SLUG, resolveListingListByIdOrSlug } from './utils/listing-lists';

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
  const googleEmail = verification.email?.trim().toLowerCase();
  if (!googleEmail) {
    return {
      statusCode: 401,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Unauthorized.' })
    };
  }

  const supabaseAdmin = getSupabaseAdmin();

  const source = event.queryStringParameters?.['source'];
  const listParam = event.queryStringParameters?.['list'];
  const listSlugParam = event.queryStringParameters?.['listSlug'];
  const listIdParam = event.queryStringParameters?.['listId'];
  const pets = parseBooleanFilter(event.queryStringParameters?.['pets']);
  const fence = parseBooleanFilter(event.queryStringParameters?.['fence']);
  const minRent = parseIntegerFilter(event.queryStringParameters?.['minRent']);
  const maxRent = parseIntegerFilter(event.queryStringParameters?.['maxRent']);
  const q = event.queryStringParameters?.['q']?.trim().toLowerCase();

  const requestedListSlug = (listSlugParam ?? listParam ?? MAIN_LIST_SLUG).trim().toLowerCase();
  const requestedListId = listIdParam?.trim() ?? '';
  const selectedList = await resolveListingListByIdOrSlug({
    listId: requestedListId || undefined,
    listSlug: requestedListSlug || MAIN_LIST_SLUG
  });
  if (!selectedList) {
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Invalid listId or list parameter.' })
    };
  }

  let customListListingIds: string[] | null = null;
  if (selectedList.slug !== MAIN_LIST_SLUG) {
    const membershipsResult = await supabaseAdmin
      .from('rental_listing_list_memberships')
      .select('listing_id')
      .eq('list_id', selectedList.id)
      .limit(1000);
    if (membershipsResult.error) {
      return {
        statusCode: 500,
        headers: defaultHeaders,
        body: JSON.stringify({ error: membershipsResult.error.message })
      };
    }
    customListListingIds = (membershipsResult.data ?? [])
      .map((row) => (typeof row.listing_id === 'string' ? row.listing_id : ''))
      .filter((value) => value.length > 0);
  }

  let query = supabaseAdmin
    .from('rental_listings')
    .select(
      'id, source, listing_url, image_url, title, address, city, state, zip, rent_price, bedrooms, bathrooms, allows_pets, has_fence, available_date, sqft, management_company, landlord_name, photo_count, identity_url_hash, address_key, is_crossed_off, status, last_seen_at'
    )
    .eq('status', 'active')
    .eq('is_crossed_off', false)
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
  if (customListListingIds) {
    if (customListListingIds.length === 0) {
      query = query.in('id', ['00000000-0000-0000-0000-000000000000']);
    } else {
      query = query.in('id', customListListingIds);
    }
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

  const likesResult = await supabaseAdmin
    .from('user_liked_listings')
    .select('listing_id')
    .eq('google_email', googleEmail)
    .order('created_at', { ascending: false })
    .limit(1000);
  if (likesResult.error) {
    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: likesResult.error.message })
    };
  }

  const likedIds = new Set(
    (likesResult.data ?? [])
      .map((row) => (typeof row.listing_id === 'string' ? row.listing_id : ''))
      .filter((listingId) => listingId.length > 0)
  );
  const likedIdentityHashes = new Set<string>();
  const likedAddressKeys = new Set<string>();
  const likedIdArray = [...likedIds];

  if (likedIdArray.length > 0) {
    const likedListingIdentityResult = await supabaseAdmin
      .from('rental_listings')
      .select('id, identity_url_hash, address_key')
      .in('id', likedIdArray);
    if (likedListingIdentityResult.error) {
      return {
        statusCode: 500,
        headers: defaultHeaders,
        body: JSON.stringify({ error: likedListingIdentityResult.error.message })
      };
    }
    for (const likedListing of likedListingIdentityResult.data ?? []) {
      if (typeof likedListing.identity_url_hash === 'string' && likedListing.identity_url_hash.length > 0) {
        likedIdentityHashes.add(likedListing.identity_url_hash);
      }
      if (typeof likedListing.address_key === 'string' && likedListing.address_key.length > 0) {
        likedAddressKeys.add(likedListing.address_key);
      }
    }
  }

  const visibleListings = filteredListings.filter((listing) => {
    if (likedIds.has(listing.id)) {
      return false;
    }
    if (
      typeof listing.identity_url_hash === 'string' &&
      listing.identity_url_hash.length > 0 &&
      likedIdentityHashes.has(listing.identity_url_hash)
    ) {
      return false;
    }
    if (typeof listing.address_key === 'string' && listing.address_key.length > 0 && likedAddressKeys.has(listing.address_key)) {
      return false;
    }
    return true;
  });

  const listingsWithLikes = visibleListings.map((listing) => {
    const { identity_url_hash: _identityUrlHash, address_key: _addressKey, ...publicListing } = listing;
    return {
      ...publicListing,
      is_liked: likedIds.has(listing.id)
    };
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
      listings: listingsWithLikes,
      selectedList: {
        id: selectedList.id,
        slug: selectedList.slug,
        name: selectedList.name
      },
      syncStatus: syncStatusResult.data ?? []
    })
  };
};
