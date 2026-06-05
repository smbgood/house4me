import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

import { verifyGoogleRefreshToken } from './auth';
import { defaultHeaders, optionsResponse } from './utils/cors';

interface CrossOffBody {
  id?: unknown;
  isCrossedOff?: unknown;
  crossOffReason?: unknown;
  crossOffNote?: unknown;
}

const CROSS_OFF_REASONS = [
  'did_not_match_requirements',
  'did_not_like_area',
  'did_not_like_house',
  'no_fence',
  'two_story',
  'no_tub',
  'too_close_to_neighbors',
  'other'
] as const;

type CrossOffReason = (typeof CROSS_OFF_REASONS)[number];

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

  if (event.httpMethod !== 'POST') {
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
    console.error('Failed to verify Google token for cross-off-listing:', error);
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

  let parsedBody: CrossOffBody;
  try {
    parsedBody = event.body ? (JSON.parse(event.body) as CrossOffBody) : {};
  } catch {
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Invalid JSON body.' })
    };
  }

  const id = typeof parsedBody.id === 'string' ? parsedBody.id.trim() : '';
  if (!id) {
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Body parameter id is required.' })
    };
  }

  const isCrossedOff =
    typeof parsedBody.isCrossedOff === 'boolean' ? parsedBody.isCrossedOff : true;
  const crossOffReasonValue =
    typeof parsedBody.crossOffReason === 'string' ? parsedBody.crossOffReason.trim() : '';
  const crossOffNote =
    typeof parsedBody.crossOffNote === 'string' ? parsedBody.crossOffNote.trim() : '';
  const crossOffReason = (
    CROSS_OFF_REASONS as readonly string[]
  ).includes(crossOffReasonValue)
    ? (crossOffReasonValue as CrossOffReason)
    : null;
  const crossedOffBy = verification.email?.trim().toLowerCase() ?? null;

  if (isCrossedOff && !crossOffReason) {
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({
        error:
          `Body parameter crossOffReason is required and must be one of: ${CROSS_OFF_REASONS.join(', ')}.`
      })
    };
  }
  if (isCrossedOff && crossOffReason === 'other' && !crossOffNote) {
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({
        error: 'Body parameter crossOffNote is required when crossOffReason is other.'
      })
    };
  }

  const supabaseAdmin = getSupabaseAdmin();
  const targetListingResult = await supabaseAdmin
    .from('rental_listings')
    .select('id, identity_url_hash, address_key')
    .eq('id', id)
    .maybeSingle();
  if (targetListingResult.error) {
    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: targetListingResult.error.message })
    };
  }
  if (!targetListingResult.data) {
    return {
      statusCode: 404,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Listing not found.' })
    };
  }

  const matchingListingIds = new Set<string>([id]);
  if (
    typeof targetListingResult.data.identity_url_hash === 'string' &&
    targetListingResult.data.identity_url_hash.length > 0
  ) {
    const sameIdentityResult = await supabaseAdmin
      .from('rental_listings')
      .select('id')
      .eq('identity_url_hash', targetListingResult.data.identity_url_hash);
    if (sameIdentityResult.error) {
      return {
        statusCode: 500,
        headers: defaultHeaders,
        body: JSON.stringify({ error: sameIdentityResult.error.message })
      };
    }
    for (const row of sameIdentityResult.data ?? []) {
      if (typeof row.id === 'string' && row.id.length > 0) {
        matchingListingIds.add(row.id);
      }
    }
  }
  if (typeof targetListingResult.data.address_key === 'string' && targetListingResult.data.address_key.length > 0) {
    const sameAddressResult = await supabaseAdmin
      .from('rental_listings')
      .select('id')
      .eq('address_key', targetListingResult.data.address_key);
    if (sameAddressResult.error) {
      return {
        statusCode: 500,
        headers: defaultHeaders,
        body: JSON.stringify({ error: sameAddressResult.error.message })
      };
    }
    for (const row of sameAddressResult.data ?? []) {
      if (typeof row.id === 'string' && row.id.length > 0) {
        matchingListingIds.add(row.id);
      }
    }
  }

  const listingIdsToUpdate = [...matchingListingIds];
  if (listingIdsToUpdate.length === 0) {
    return {
      statusCode: 404,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Listing not found.' })
    };
  }

  const updatePayload = isCrossedOff
    ? {
        is_crossed_off: true,
        cross_off_reason: crossOffReason,
        cross_off_note: crossOffReason === 'other' ? crossOffNote : null,
        crossed_off_by: crossedOffBy,
        crossed_off_at: new Date().toISOString()
      }
    : {
        is_crossed_off: false,
        cross_off_reason: null,
        cross_off_note: null,
        crossed_off_by: null,
        crossed_off_at: null
      };
  const updateResult = await supabaseAdmin
    .from('rental_listings')
    .update(updatePayload)
    .in('id', listingIdsToUpdate)
    .select('id, is_crossed_off, cross_off_reason, cross_off_note, crossed_off_by, crossed_off_at')
    .limit(1000);

  if (updateResult.error) {
    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: updateResult.error.message })
    };
  }

  const updatedRows = updateResult.data ?? [];
  if (updatedRows.length === 0) {
    return {
      statusCode: 404,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Listing not found.' })
    };
  }
  const targetUpdatedRow =
    updatedRows.find((row) => row.id === id) ??
    updatedRows[0];

  return {
    statusCode: 200,
    headers: defaultHeaders,
    body: JSON.stringify({
      listing: targetUpdatedRow,
      affected_count: updatedRows.length
    })
  };
};
