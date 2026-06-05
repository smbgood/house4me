import type { Handler } from '@netlify/functions';

import { defaultHeaders, optionsResponse } from './utils/cors';
import { MAIN_LIST_SLUG, resolveListingListByIdOrSlug } from './utils/listing-lists';
import { formatIngestError, getBearerToken, logIngestError, normalizeRealtorListings } from './utils/realtor-ingest';
import { supabaseAdmin } from './utils/supabase';

const LOG_PREFIX = '[ingest-realtor]';

interface IngestBody {
  listings?: unknown;
  listId?: unknown;
  listSlug?: unknown;
}

function resolveSiteUrl(): string {
  const baseUrl = process.env['URL'] ?? process.env['DEPLOY_PRIME_URL'] ?? 'http://localhost:9999';
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

export const handler: Handler = async (event) => {
  const requestStartedAt = Date.now();

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
    console.warn(`${LOG_PREFIX} Unauthorized ingest request.`);
    return {
      statusCode: 401,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Unauthorized.' })
    };
  }

  let parsedBody: IngestBody;
  try {
    parsedBody = event.body ? (JSON.parse(event.body) as IngestBody) : {};
  } catch (parseError) {
    logIngestError('Failed to parse request JSON', parseError);
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Invalid JSON body.' })
    };
  }

  if (!Array.isArray(parsedBody.listings)) {
    console.warn(`${LOG_PREFIX} Request body missing listings array.`);
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Request body must include a listings array.' })
    };
  }

  const listId = typeof parsedBody.listId === 'string' ? parsedBody.listId.trim() : '';
  const listSlug = typeof parsedBody.listSlug === 'string' ? parsedBody.listSlug.trim().toLowerCase() : '';
  let selectedList = null;
  if (listId || listSlug) {
    selectedList = await resolveListingListByIdOrSlug({
      listId: listId || undefined,
      listSlug: listSlug || undefined
    });
    if (!selectedList) {
      return {
        statusCode: 400,
        headers: defaultHeaders,
        body: JSON.stringify({ error: 'Invalid listId or listSlug.' })
      };
    }
  }

  const targetListId = selectedList && selectedList.slug !== MAIN_LIST_SLUG ? selectedList.id : null;
  const targetListSlug = selectedList?.slug ?? MAIN_LIST_SLUG;

  const bodyBytes = event.body?.length ?? 0;
  console.log(
    `${LOG_PREFIX} Request received with ${parsedBody.listings.length} listings (${bodyBytes} byte body).`
  );

  const { normalizedFromExtension, dedupedUrls, duplicateUrlCount, rejectedDuringNormalization } =
    normalizeRealtorListings(parsedBody.listings);

  if (rejectedDuringNormalization > 0) {
    console.warn(
      `${LOG_PREFIX} ${rejectedDuringNormalization} listing(s) rejected during normalization (missing or invalid listingUrl).`
    );
  }

  if (duplicateUrlCount > 0) {
    console.log(`${LOG_PREFIX} Collapsed ${duplicateUrlCount} duplicate listing URL(s).`);
  }

  const runInsert = await supabaseAdmin
    .from('source_sync_runs')
    .insert({
      source: 'realtor',
      status: 'started',
      started_at: new Date().toISOString(),
      metadata: {
        mode: 'manual-addon',
        submittedCount: parsedBody.listings.length,
        normalizedCount: normalizedFromExtension.length,
        queuedCount: dedupedUrls.length,
        targetListSlug
      }
    })
    .select('id')
    .single();

  if (runInsert.error) {
    logIngestError('Failed to create source_sync_runs row', runInsert.error);
    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: formatIngestError(runInsert.error) })
    };
  }

  const runId = runInsert.data?.id;
  if (!runId) {
    console.error(`${LOG_PREFIX} Failed to create source_sync_runs row: missing run id.`);
    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Failed to create sync run.' })
    };
  }

  console.log(`${LOG_PREFIX} Sync run ${runId} created.`);

  const backgroundUrl = `${resolveSiteUrl()}/.netlify/functions/ingest-realtor-listings-background`;
  const requestPayload = JSON.stringify({
    runId,
    extensionListings: normalizedFromExtension,
    targetListId,
    targetListSlug
  });

  try {
    const queueResponse = await fetch(backgroundUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${configuredToken}`,
        'Content-Type': 'application/json'
      },
      body: requestPayload
    });

    if (queueResponse.status !== 202) {
      const responseText = await queueResponse.text().catch(() => '');
      const errorMessage = `Failed to queue background ingest (status ${queueResponse.status}).`;
      logIngestError(errorMessage, responseText || 'No response body');

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

    console.log(
      `${LOG_PREFIX} Queued background ingest for run ${runId} in ${Date.now() - requestStartedAt}ms.`
    );

    return {
      statusCode: 200,
      headers: defaultHeaders,
      body: JSON.stringify({
        source: 'realtor',
        status: 'queued',
        runId,
        received: parsedBody.listings.length,
        accepted: dedupedUrls.length,
        rejected: parsedBody.listings.length - dedupedUrls.length,
        imported_to_list: targetListSlug
      })
    };
  } catch (error) {
    const errorMessage = formatIngestError(error);
    logIngestError(`Ingest queueing failed after ${Date.now() - requestStartedAt}ms`, error);

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
