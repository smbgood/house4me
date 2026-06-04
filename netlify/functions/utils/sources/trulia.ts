import * as cheerio from 'cheerio';

import { fetchHtml } from './http';
import { inferFenceValue, inferPetsValue, parseNumber, parseRent, toAbsoluteUrl } from './normalize';
import { type NormalizedListingInput, type SearchConfig, type SourceAdapter } from './types';

const BASE_URL = 'https://www.trulia.com';

function resolveSearchUrl(config: SearchConfig): string {
  const override = process.env['TRULIA_SEARCH_URL']?.trim();
  if (override) {
    return override;
  }

  const query = `${config.city}-${config.state}`.replace(/\s+/g, '-');
  return `${BASE_URL}/for_rent/${query}/`;
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function collectCandidates($: cheerio.CheerioAPI): unknown[] {
  const results: unknown[] = [];

  $('script[type="application/ld+json"]').each((_, element) => {
    const parsed = tryParseJson($(element).text());
    if (!parsed) {
      return;
    }
    if (Array.isArray(parsed)) {
      results.push(...parsed);
      return;
    }
    results.push(parsed);
  });

  return results;
}

function flattenListings(candidates: unknown[]): unknown[] {
  const listings: unknown[] = [];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    const typed = candidate as { ['@type']?: string; itemListElement?: unknown[] };
    if (typed['@type'] === 'ItemList' && Array.isArray(typed.itemListElement)) {
      listings.push(...typed.itemListElement);
      continue;
    }

    if (typed['@type'] === 'Apartment' || typed['@type'] === 'SingleFamilyResidence') {
      listings.push({ item: candidate });
    }
  }

  return listings;
}

function mapListing(candidate: unknown, pageText: string): NormalizedListingInput | null {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }
  const item = (candidate as { item?: unknown }).item ?? candidate;
  if (!item || typeof item !== 'object') {
    return null;
  }

  const listing = item as {
    url?: string;
    name?: string;
    description?: string;
    image?: string | string[];
    address?: { streetAddress?: string; addressLocality?: string; addressRegion?: string; postalCode?: string };
    numberOfRooms?: number | string;
    numberOfBathroomsTotal?: number | string;
    offers?: { price?: number | string };
  };

  const listingUrl = toAbsoluteUrl(listing.url, BASE_URL);
  if (!listingUrl) {
    return null;
  }

  const imageValue = Array.isArray(listing.image) ? listing.image[0] : listing.image;
  const textBlob = `${listing.name ?? ''} ${listing.description ?? ''} ${pageText}`;

  return {
    source: 'trulia',
    listingUrl,
    imageUrl: toAbsoluteUrl(imageValue, BASE_URL),
    title: listing.name,
    address: listing.address?.streetAddress,
    city: listing.address?.addressLocality,
    state: listing.address?.addressRegion,
    zip: listing.address?.postalCode,
    rentPrice: parseRent(listing.offers?.price),
    bedrooms: parseNumber(listing.numberOfRooms),
    bathrooms: parseNumber(listing.numberOfBathroomsTotal),
    allowsPets: inferPetsValue(textBlob),
    hasFence: inferFenceValue(textBlob),
    rawSnippet: listing.description,
    rawPayload: candidate
  };
}

async function fetchListings(config: SearchConfig): Promise<NormalizedListingInput[]> {
  const searchUrl = resolveSearchUrl(config);
  const html = await fetchHtml(searchUrl);

  const $ = cheerio.load(html);
  const pageText = $('body').text();
  const candidates = flattenListings(collectCandidates($));

  const deduped = new Map<string, NormalizedListingInput>();
  for (const candidate of candidates) {
    const listing = mapListing(candidate, pageText);
    if (listing) {
      deduped.set(listing.listingUrl, listing);
    }
  }

  return [...deduped.values()];
}

export const truliaAdapter: SourceAdapter = {
  source: 'trulia',
  fetchListings
};
