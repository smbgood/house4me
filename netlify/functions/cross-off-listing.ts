import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

import { verifyGoogleRefreshToken } from './auth';
import { defaultHeaders, optionsResponse } from './utils/cors';

interface CrossOffBody {
  id?: unknown;
  isCrossedOff?: unknown;
  crossOffReason?: unknown;
}

const CROSS_OFF_REASONS = [
  'did_not_match_requirements',
  'did_not_like_area',
  'did_not_like_house'
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
          'Body parameter crossOffReason is required and must be one of: did_not_match_requirements, did_not_like_area, did_not_like_house.'
      })
    };
  }

  const supabaseAdmin = getSupabaseAdmin();
  const updatePayload = isCrossedOff
    ? {
        is_crossed_off: true,
        cross_off_reason: crossOffReason,
        crossed_off_by: crossedOffBy,
        crossed_off_at: new Date().toISOString()
      }
    : {
        is_crossed_off: false,
        cross_off_reason: null,
        crossed_off_by: null,
        crossed_off_at: null
      };
  const updateResult = await supabaseAdmin
    .from('rental_listings')
    .update(updatePayload)
    .eq('id', id)
    .select('id, is_crossed_off, cross_off_reason, crossed_off_by, crossed_off_at')
    .maybeSingle();

  if (updateResult.error) {
    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: updateResult.error.message })
    };
  }

  if (!updateResult.data) {
    return {
      statusCode: 404,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Listing not found.' })
    };
  }

  return {
    statusCode: 200,
    headers: defaultHeaders,
    body: JSON.stringify({
      listing: updateResult.data
    })
  };
};
