import type { Handler } from '@netlify/functions';
import { OAuth2Client } from 'google-auth-library';

import { defaultHeaders, optionsResponse } from './utils/cors';

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getOAuthClient(): OAuth2Client {
  return new OAuth2Client(
    getRequiredEnv('GOOGLE_CLIENT_ID'),
    getRequiredEnv('GOOGLE_CLIENT_SECRET'),
    getRequiredEnv('GOOGLE_REDIRECT_URI')
  );
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

  const code = event.queryStringParameters?.['code'];
  const state = event.queryStringParameters?.['state'] ?? '/';
  if (!code) {
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'No authorization code provided.' })
    };
  }

  try {
    const oauthClient = getOAuthClient();
    const { tokens } = await oauthClient.getToken(code);

    if (!tokens.refresh_token) {
      return {
        statusCode: 400,
        headers: defaultHeaders,
        body: JSON.stringify({
          error: 'Google did not return a refresh token. Re-consent may be required.'
        })
      };
    }

    return {
      statusCode: 200,
      headers: defaultHeaders,
      body: JSON.stringify({
        success: true,
        refreshToken: tokens.refresh_token,
        state
      })
    };
  } catch (error) {
    console.error('OAuth callback error:', error);
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Google authentication failed.'
      })
    };
  }
};
