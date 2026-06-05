import type { Handler } from '@netlify/functions';

import { defaultHeaders, optionsResponse } from './utils/cors';
import { authorizeGoogleOrIngest, createListingList } from './utils/listing-lists';

interface CreateListBody {
  name?: unknown;
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

  let authorized;
  try {
    authorized = await authorizeGoogleOrIngest(event.headers);
  } catch (error) {
    console.error('Failed to verify auth for create-listing-list:', error);
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

  let parsedBody: CreateListBody;
  try {
    parsedBody = event.body ? (JSON.parse(event.body) as CreateListBody) : {};
  } catch {
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Invalid JSON body.' })
    };
  }

  const name = typeof parsedBody.name === 'string' ? parsedBody.name.trim() : '';
  if (!name) {
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Body parameter name is required.' })
    };
  }

  try {
    const list = await createListingList(name);
    return {
      statusCode: 200,
      headers: defaultHeaders,
      body: JSON.stringify({ list })
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create listing list.';
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({ error: message })
    };
  }
};
