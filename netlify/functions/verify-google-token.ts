import type { Handler } from '@netlify/functions';

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

  try {
    const token = parseBearerToken(event.headers);
    if (!token) {
      return {
        statusCode: 401,
        headers: defaultHeaders,
        body: JSON.stringify({ error: 'Missing bearer token.' })
      };
    }

    const verification = await verifyGoogleRefreshToken(token);
    if (!verification.valid) {
      return {
        statusCode: 401,
        headers: defaultHeaders,
        body: JSON.stringify({ error: 'Unauthorized.' })
      };
    }

    return {
      statusCode: 200,
      headers: defaultHeaders,
      body: JSON.stringify({ success: true, email: verification.email })
    };
  } catch (error) {
    console.error('Failed to verify Google refresh token:', error);
    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Token verification failed.' })
    };
  }
};
