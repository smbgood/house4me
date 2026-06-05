import type { Handler } from '@netlify/functions';

import { defaultHeaders, optionsResponse } from './utils/cors';
import { authorizeGoogleOrIngest, getListingLists } from './utils/listing-lists';

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

  let authorized;
  try {
    authorized = await authorizeGoogleOrIngest(event.headers);
  } catch (error) {
    console.error('Failed to verify auth for get-listing-lists:', error);
    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Auth configuration error.' })
    };
  }

  if (!authorized) {
    return {
      statusCode: 401,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Unauthorized.' })
    };
  }

  try {
    const lists = await getListingLists();
    return {
      statusCode: 200,
      headers: defaultHeaders,
      body: JSON.stringify({ lists })
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load listing lists.';
    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: message })
    };
  }
};
