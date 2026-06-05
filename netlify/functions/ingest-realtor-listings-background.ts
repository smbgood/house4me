import type { Handler } from '@netlify/functions';

import { defaultHeaders, optionsResponse } from './utils/cors';
import {
  formatIngestError,
  getBearerToken,
  logIngestError,
  processRealtorListingsSequential
} from './utils/realtor-ingest';
import { type NormalizedListingInput } from './utils/sources/types';
import { supabaseAdmin } from './utils/supabase';

interface BackgroundIngestBody {
  runId?: unknown;
  extensionListings?: unknown;
}

const LOG_PREFIX = '[ingest-realtor]';

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

  const configuredToken = process.env['REALTOR_INGEST_TOKEN'];
  if (!configuredToken) {
    console.error(`${LOG_PREFIX} Missing REALTOR_INGEST_TOKEN environment variable.`);
    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Missing REALTOR_INGEST_TOKEN environment variable.' })
    };
  }

  const token = getBearerToken(event.headers);
  if (!token || token !== configuredToken) {
    console.warn(`${LOG_PREFIX} Unauthorized background ingest request.`);
    return {
      statusCode: 401,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Unauthorized.' })
    };
  }

  let parsedBody: BackgroundIngestBody;
  try {
    parsedBody = event.body ? (JSON.parse(event.body) as BackgroundIngestBody) : {};
  } catch (parseError) {
    logIngestError('Failed to parse background request JSON', parseError);
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Invalid JSON body.' })
    };
  }

  if (typeof parsedBody.runId !== 'string' || parsedBody.runId.length === 0) {
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Request body must include a runId string.' })
    };
  }

  if (!Array.isArray(parsedBody.extensionListings)) {
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Request body must include an extensionListings array.' })
    };
  }

  const runId = parsedBody.runId;
  const extensionListings = parsedBody.extensionListings as NormalizedListingInput[];

  console.log(`${LOG_PREFIX} Background run ${runId} started with ${extensionListings.length} listing payload(s).`);

  try {
    const { accepted, upserted } = await processRealtorListingsSequential(extensionListings);

    const runUpdate = await supabaseAdmin
      .from('source_sync_runs')
      .update({
        status: 'success',
        completed_at: new Date().toISOString(),
        listings_found: accepted,
        listings_upserted: upserted
      })
      .eq('id', runId);

    if (runUpdate.error) {
      logIngestError(`Failed to mark sync run ${runId} as success`, runUpdate.error);
    }

    console.log(`${LOG_PREFIX} Background run ${runId} completed: accepted=${accepted}, upserted=${upserted}.`);
    return {
      statusCode: 200,
      headers: defaultHeaders,
      body: JSON.stringify({ runId, accepted, upserted })
    };
  } catch (error) {
    const errorMessage = formatIngestError(error);
    logIngestError(`Background run ${runId} failed`, error);

    const runUpdate = await supabaseAdmin
      .from('source_sync_runs')
      .update({
        status: 'error',
        completed_at: new Date().toISOString(),
        error_summary: errorMessage
      })
      .eq('id', runId);

    if (runUpdate.error) {
      logIngestError(`Failed to mark sync run ${runId} as error`, runUpdate.error);
    }

    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: errorMessage })
    };
  }
};
