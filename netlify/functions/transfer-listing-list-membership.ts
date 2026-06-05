import type { Handler } from '@netlify/functions';

import { defaultHeaders, optionsResponse } from './utils/cors';
import {
  MAIN_LIST_SLUG,
  authorizeGoogleOrIngest,
  resolveListingListByIdOrSlug,
  type ListingList
} from './utils/listing-lists';
import { supabaseAdmin } from './utils/supabase';

type TransferOperation = 'copy' | 'move';

interface TransferBody {
  listingId?: unknown;
  targetListSlug?: unknown;
  targetListId?: unknown;
  sourceListSlug?: unknown;
  sourceListId?: unknown;
  operation?: unknown;
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
    console.error('Failed to verify auth for transfer-listing-list-membership:', error);
    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Auth configuration error.' })
    };
  }

  if (!authorized || authorized.kind !== 'google') {
    return {
      statusCode: 401,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Unauthorized.' })
    };
  }

  let parsedBody: TransferBody;
  try {
    parsedBody = event.body ? (JSON.parse(event.body) as TransferBody) : {};
  } catch {
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Invalid JSON body.' })
    };
  }

  const listingId = typeof parsedBody.listingId === 'string' ? parsedBody.listingId.trim() : '';
  const targetListSlug = typeof parsedBody.targetListSlug === 'string' ? parsedBody.targetListSlug.trim() : '';
  const targetListId = typeof parsedBody.targetListId === 'string' ? parsedBody.targetListId.trim() : '';
  const sourceListSlug = typeof parsedBody.sourceListSlug === 'string' ? parsedBody.sourceListSlug.trim() : '';
  const sourceListId = typeof parsedBody.sourceListId === 'string' ? parsedBody.sourceListId.trim() : '';
  const operation = parsedBody.operation === 'move' ? 'move' : parsedBody.operation === 'copy' ? 'copy' : '';

  if (!listingId) {
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Body parameter listingId is required.' })
    };
  }
  if (!operation) {
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Body parameter operation must be "copy" or "move".' })
    };
  }
  if (!targetListSlug && !targetListId) {
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Body parameter targetListSlug or targetListId is required.' })
    };
  }

  const listingResult = await supabaseAdmin
    .from('rental_listings')
    .select('id')
    .eq('id', listingId)
    .maybeSingle();
  if (listingResult.error) {
    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: listingResult.error.message })
    };
  }
  if (!listingResult.data) {
    return {
      statusCode: 404,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Listing not found.' })
    };
  }

  let targetList: ListingList | null = null;
  try {
    targetList = await resolveListingListByIdOrSlug({
      listId: targetListId || undefined,
      listSlug: targetListSlug || undefined
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to resolve target list.';
    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: message })
    };
  }
  if (!targetList) {
    return {
      statusCode: 404,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Target list not found.' })
    };
  }
  if (targetList.slug === MAIN_LIST_SLUG || targetList.is_system) {
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Target list must be a user-created list.' })
    };
  }

  let sourceList: ListingList | null = null;
  if (operation === 'move') {
    if (!sourceListSlug && !sourceListId) {
      return {
        statusCode: 400,
        headers: defaultHeaders,
        body: JSON.stringify({ error: 'Body parameter sourceListSlug or sourceListId is required for move.' })
      };
    }
    try {
      sourceList = await resolveListingListByIdOrSlug({
        listId: sourceListId || undefined,
        listSlug: sourceListSlug || undefined
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to resolve source list.';
      return {
        statusCode: 500,
        headers: defaultHeaders,
        body: JSON.stringify({ error: message })
      };
    }
    if (!sourceList) {
      return {
        statusCode: 404,
        headers: defaultHeaders,
        body: JSON.stringify({ error: 'Source list not found.' })
      };
    }
    if (sourceList.slug === MAIN_LIST_SLUG || sourceList.is_system) {
      return {
        statusCode: 400,
        headers: defaultHeaders,
        body: JSON.stringify({ error: 'Move is only allowed from a user-created source list.' })
      };
    }
    if (sourceList.id === targetList.id) {
      return {
        statusCode: 400,
        headers: defaultHeaders,
        body: JSON.stringify({ error: 'Source and target lists must be different.' })
      };
    }
  } else if (
    (sourceListId && sourceListId === targetList.id) ||
    (sourceListSlug && sourceListSlug.toLowerCase() === targetList.slug)
  ) {
    return {
      statusCode: 400,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Source and target lists must be different.' })
    };
  }

  const upsertResult = await supabaseAdmin.from('rental_listing_list_memberships').upsert(
    {
      list_id: targetList.id,
      listing_id: listingId
    },
    {
      onConflict: 'list_id,listing_id',
      ignoreDuplicates: true
    }
  );
  if (upsertResult.error) {
    return {
      statusCode: 500,
      headers: defaultHeaders,
      body: JSON.stringify({ error: upsertResult.error.message })
    };
  }

  let removedFromSource = false;
  if (operation === 'move' && sourceList) {
    const deleteResult = await supabaseAdmin
      .from('rental_listing_list_memberships')
      .delete()
      .eq('list_id', sourceList.id)
      .eq('listing_id', listingId);
    if (deleteResult.error) {
      return {
        statusCode: 500,
        headers: defaultHeaders,
        body: JSON.stringify({ error: deleteResult.error.message })
      };
    }
    removedFromSource = true;
  }

  return {
    statusCode: 200,
    headers: defaultHeaders,
    body: JSON.stringify({
      listingId,
      operation: operation as TransferOperation,
      targetList: {
        id: targetList.id,
        slug: targetList.slug,
        name: targetList.name
      },
      sourceList: sourceList
        ? {
            id: sourceList.id,
            slug: sourceList.slug,
            name: sourceList.name
          }
        : null,
      removedFromSource
    })
  };
};
