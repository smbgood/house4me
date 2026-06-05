import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

import { verifyGoogleRefreshToken } from './auth';
import { defaultHeaders, optionsResponse } from './utils/cors';

interface CrossOffBody {
  id?: unknown;
  isCrossedOff?: unknown;
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

  const supabaseAdmin = getSupabaseAdmin();
  const updateResult = await supabaseAdmin
    .from('rental_listings')
    .update({ is_crossed_off: isCrossedOff })
    .eq('id', id)
    .select('id, is_crossed_off')
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
