import { upsertListingsAndSnapshots } from './listing-upsert';
import { inferFenceValue, inferPetsValue, parseNumber, parseRent, toAbsoluteUrl } from './sources/normalize';
import { fetchAndParseRealtorListing } from './sources/realtor';
import { type NormalizedListingInput } from './sources/types';

const REALTOR_BASE_URL = 'https://www.realtor.com';
const LOG_PREFIX = '[ingest-realtor]';

export interface NormalizeRealtorListingsResult {
  normalizedFromExtension: NormalizedListingInput[];
  dedupedUrls: string[];
  rejectedDuringNormalization: number;
  duplicateUrlCount: number;
}

export interface ProcessRealtorListingsResult {
  accepted: number;
  upserted: number;
}

interface ProcessRealtorListingsOptions {
  targetListId?: string | null;
}

export function formatIngestError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }
  return 'Unknown ingest error';
}

export function logIngestError(context: string, error: unknown): void {
  const message = formatIngestError(error);
  if (error instanceof Error) {
    console.error(`${LOG_PREFIX} ${context}: ${message}`, { stack: error.stack });
    return;
  }
  console.error(`${LOG_PREFIX} ${context}: ${message}`, error);
}

export function getBearerToken(headers: Record<string, string | undefined>): string | null {
  const value = headers['authorization'] ?? headers['Authorization'];
  if (!value) {
    return null;
  }
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function normalizeIncomingRealtorListing(input: unknown): NormalizedListingInput | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const candidate = input as {
    listingUrl?: unknown;
    sourceListingId?: unknown;
    sourcePropertyId?: unknown;
    imageUrl?: unknown;
    title?: unknown;
    address?: unknown;
    city?: unknown;
    state?: unknown;
    zip?: unknown;
    rentPrice?: unknown;
    bedrooms?: unknown;
    bathrooms?: unknown;
    allowsPets?: unknown;
    hasFence?: unknown;
    rawSnippet?: unknown;
    rawPayload?: unknown;
  };

  const listingUrl = toAbsoluteUrl(
    typeof candidate.listingUrl === 'string' ? candidate.listingUrl : undefined,
    REALTOR_BASE_URL
  );
  if (!listingUrl) {
    return null;
  }

  const sourceText = [
    typeof candidate.title === 'string' ? candidate.title : '',
    typeof candidate.rawSnippet === 'string' ? candidate.rawSnippet : ''
  ]
    .join(' ')
    .trim();

  return {
    source: 'realtor',
    sourceListingId: typeof candidate.sourceListingId === 'string' ? candidate.sourceListingId : undefined,
    sourcePropertyId: typeof candidate.sourcePropertyId === 'string' ? candidate.sourcePropertyId : undefined,
    listingUrl,
    imageUrl: toAbsoluteUrl(typeof candidate.imageUrl === 'string' ? candidate.imageUrl : undefined, REALTOR_BASE_URL),
    title: typeof candidate.title === 'string' ? candidate.title : undefined,
    address: typeof candidate.address === 'string' ? candidate.address : undefined,
    city: typeof candidate.city === 'string' ? candidate.city : undefined,
    state: typeof candidate.state === 'string' ? candidate.state : undefined,
    zip: typeof candidate.zip === 'string' ? candidate.zip : undefined,
    rentPrice: parseRent(candidate.rentPrice),
    bedrooms: parseNumber(candidate.bedrooms),
    bathrooms: parseNumber(candidate.bathrooms),
    allowsPets: typeof candidate.allowsPets === 'boolean' ? candidate.allowsPets : inferPetsValue(sourceText),
    hasFence: typeof candidate.hasFence === 'boolean' ? candidate.hasFence : inferFenceValue(sourceText),
    rawSnippet: typeof candidate.rawSnippet === 'string' ? candidate.rawSnippet : undefined,
    rawPayload: candidate.rawPayload ?? input
  };
}

export function normalizeRealtorListings(listings: unknown[]): NormalizeRealtorListingsResult {
  const normalizedFromExtension = listings
    .map((listing) => normalizeIncomingRealtorListing(listing))
    .filter((listing): listing is NormalizedListingInput => Boolean(listing));

  const dedupedUrls = [...new Set(normalizedFromExtension.map((listing) => listing.listingUrl))];
  return {
    normalizedFromExtension,
    dedupedUrls,
    rejectedDuringNormalization: listings.length - normalizedFromExtension.length,
    duplicateUrlCount: normalizedFromExtension.length - dedupedUrls.length
  };
}

export async function processRealtorListingsSequential(
  extensionListings: NormalizedListingInput[],
  options: ProcessRealtorListingsOptions = {}
): Promise<ProcessRealtorListingsResult> {
  const dedupedUrls = [...new Set(extensionListings.map((listing) => listing.listingUrl))];
  const extensionListingByUrl = new Map(extensionListings.map((listing) => [listing.listingUrl, listing]));

  const startedAt = Date.now();
  let accepted = 0;
  let upserted = 0;

  console.log(`${LOG_PREFIX} Sequential enrichment started for ${dedupedUrls.length} listing URL(s).`);

  for (let index = 0; index < dedupedUrls.length; index += 1) {
    const listingUrl = dedupedUrls[index];
    let listing = extensionListingByUrl.get(listingUrl) ?? null;

    try {
      const enriched = await fetchAndParseRealtorListing(listingUrl);
      if (enriched) {
        listing = enriched;
      }
    } catch (fetchError) {
      console.warn(`${LOG_PREFIX} Enrichment failed for ${listingUrl}: ${formatIngestError(fetchError)}`);
    }

    if (!listing) {
      continue;
    }

    const upsertCount = await upsertListingsAndSnapshots([listing], new Date().toISOString(), {
      targetListId: options.targetListId ?? null
    });
    upserted += upsertCount;
    accepted += 1;

    if ((index + 1) % 10 === 0 || index + 1 === dedupedUrls.length) {
      console.log(`${LOG_PREFIX} Sequential progress: ${index + 1}/${dedupedUrls.length}.`);
    }
  }

  console.log(
    `${LOG_PREFIX} Sequential enrichment complete in ${Date.now() - startedAt}ms: accepted=${accepted}, upserted=${upserted}.`
  );

  return {
    accepted,
    upserted
  };
}
