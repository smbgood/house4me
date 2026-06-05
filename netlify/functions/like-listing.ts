import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

import { verifyGoogleRefreshToken } from './auth';
import { defaultHeaders, optionsResponse } from './utils/cors';

interface LikeBody {
  id?: unknown;
  isLiked?: unknown;
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
    console.error('Failed to verify Google token for like-listing:', error);
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

  let parsedBody: LikeBody;
  try {
    parsedBody = event.body ? (JSON.parse(event.body) as LikeBody) : {};
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

  const isLiked = typeof parsedBody.isLiked === 'boolean' ? parsedBody.isLiked : true;
  const supabaseAdmin = getSupabaseAdmin();
  let otherLikers: string[] = [];

  if (isLiked) {
    const otherLikersResult = await supabaseAdmin
      .from('user_liked_listings')
      .select('google_email')
      .eq('listing_id', id)
      .neq('google_email', googleEmail);
    if (otherLikersResult.error) {
      return {
        statusCode: 500,
        headers: defaultHeaders,
        body: JSON.stringify({ error: otherLikersResult.error.message })
      };
    }

    otherLikers = Array.from(
      new Set(
        (otherLikersResult.data ?? [])
          .map((row) => (typeof row.google_email === 'string' ? row.google_email.trim().toLowerCase() : ''))
          .filter((email) => email.length > 0)
      )
    );

    const insertResult = await supabaseAdmin.from('user_liked_listings').upsert(
      {
        google_email: googleEmail,
        listing_id: id
      },
      {
        onConflict: 'google_email,listing_id',
        ignoreDuplicates: true
      }
    );
    if (insertResult.error) {
      return {
        statusCode: 500,
        headers: defaultHeaders,
        body: JSON.stringify({ error: insertResult.error.message })
      };
    }
  } else {
    const deleteResult = await supabaseAdmin
      .from('user_liked_listings')
      .delete()
      .eq('google_email', googleEmail)
      .eq('listing_id', id);
    if (deleteResult.error) {
      return {
        statusCode: 500,
        headers: defaultHeaders,
        body: JSON.stringify({ error: deleteResult.error.message })
      };
    }
  }

  return {
    statusCode: 200,
    headers: defaultHeaders,
    body: JSON.stringify({
      listing: {
        id,
        is_liked: isLiked
      },
      other_likers: otherLikers
    })
  };
};
