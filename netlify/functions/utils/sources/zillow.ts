import * as cheerio from 'cheerio';

import { fetchHtml } from './http';
import { inferFenceValue, inferPetsValue, parseNumber, parseRent, toAbsoluteUrl } from './normalize';
import { type NormalizedListingInput, type SearchConfig, type SourceAdapter } from './types';

const BASE_URL = 'https://www.zillow.com';

function parseJsonObject(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function collectJsonLdListings($: cheerio.CheerioAPI): unknown[] {
  const entries: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    const content = $(element).text();
    if (!content) {
      return;
    }
    entries.push(...parseJsonObject(content));
  });
  return entries;
}

function extractItemListCandidates(entries: unknown[]): unknown[] {
  const items: unknown[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const typed = entry as { ['@type']?: string; itemListElement?: unknown[]; offers?: unknown };
    if (typed['@type'] === 'ItemList' && Array.isArray(typed.itemListElement)) {
      items.push(...typed.itemListElement);
      continue;
    }
    if (typed['@type'] === 'SingleFamilyResidence' || typed['@type'] === 'Apartment') {
      items.push({ item: typed });
    }
  }
  return items;
}

function mapCandidateToListing(candidate: unknown, pageText: string): NormalizedListingInput | null {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }
  const item = (candidate as { item?: unknown }).item ?? candidate;
  if (!item || typeof item !== 'object') {
    return null;
  }

  const listing = item as {
    url?: string;
    image?: string | string[];
    name?: string;
    description?: string;
    identifier?: string;
    address?: { streetAddress?: string; addressLocality?: string; addressRegion?: string; postalCode?: string };
    numberOfRooms?: number | string;
    numberOfBathroomsTotal?: number | string;
    offers?: { price?: number | string };
  };

  const listingUrl = toAbsoluteUrl(listing.url, BASE_URL);
  if (!listingUrl) {
    return null;
  }

  const textBlob = `${listing.name ?? ''} ${listing.description ?? ''} ${pageText}`;
  const imageValue = Array.isArray(listing.image) ? listing.image[0] : listing.image;

  return {
    source: 'zillow',
    sourceListingId: listing.identifier,
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
  const query = `${config.city}-${config.state}`.replace(/\s+/g, '-');
  const searchUrl = `${BASE_URL}/homes/for_rent/${query}_rb/`;
  const html = await fetchHtml(searchUrl);

  const $ = cheerio.load(html);
  const pageText = $('body').text();
  const entries = collectJsonLdListings($);
  const candidates = extractItemListCandidates(entries);

  const mapped = candidates
    .map((candidate) => mapCandidateToListing(candidate, pageText))
    .filter((listing): listing is NormalizedListingInput => Boolean(listing));

  const deduped = new Map<string, NormalizedListingInput>();
  for (const listing of mapped) {
    deduped.set(listing.listingUrl, listing);
  }

  return [...deduped.values()];
}

export const zillowAdapter: SourceAdapter = {
  source: 'zillow',
  fetchListings
};
