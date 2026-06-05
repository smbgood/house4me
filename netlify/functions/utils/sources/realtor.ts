import * as cheerio from 'cheerio';

import { fetchHtml } from './http';
import { inferFenceValue, inferPetsValue, parseNumber, parseRent, toAbsoluteUrl } from './normalize';
import { type NormalizedListingInput, type SearchConfig, type SourceAdapter } from './types';

const REALTOR_BASE_URL = 'https://www.realtor.com';

interface RealtorDetailCategory {
  category?: string;
  parent_category?: string;
  text?: string[];
}

interface RealtorPropertyDetails {
  property_id?: string;
  listing_id?: string;
  href?: string;
  list_price?: number | string;
  details?: RealtorDetailCategory[];
  description?: {
    text?: string;
    beds?: number | string;
    baths?: number | string;
    baths_full?: number | string;
    sqft?: number | string;
  };
  availability?: {
    date?: string;
  };
  tags?: string[];
  pet_policy?: {
    cats?: boolean;
    dogs?: boolean;
  };
  consumer_advertisers?: Array<{ name?: string | null }>;
  listing_information?: {
    landlord_full_name?: string;
  };
  photo_count?: number | string;
  popularity?: unknown;
}

interface ParsedRealtorData {
  propertyDetails?: RealtorPropertyDetails;
}

function tryParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function extractParsedDataFromNextData(html: string): ParsedRealtorData | null {
  const $ = cheerio.load(html);
  const raw = $('#__NEXT_DATA__').text().trim();
  if (!raw) {
    return null;
  }

  const parsed = tryParseJson(raw) as
    | {
        props?: { pageProps?: { initialReduxState?: { propertyDetails?: RealtorPropertyDetails } } };
      }
    | null;
  if (!parsed) {
    return null;
  }

  return {
    propertyDetails: parsed.props?.pageProps?.initialReduxState?.propertyDetails
  };
}

function normalizeAvailabilityDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1];
}

function getDetailsText(propertyDetails: RealtorPropertyDetails): string {
  const detailText = (propertyDetails.details ?? [])
    .flatMap((entry) => entry.text ?? [])
    .join(' ');
  return `${propertyDetails.description?.text ?? ''} ${detailText}`.trim();
}

function parseInteger(value: unknown): number | undefined {
  const parsed = parseNumber(value);
  if (parsed === undefined) {
    return undefined;
  }
  return Math.round(parsed);
}

function extractAddressFromPermalink(listingUrl: string): {
  title?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
} {
  const url = new URL(listingUrl);
  const pathParts = url.pathname.split('/').filter(Boolean);
  const permalink = pathParts[pathParts.length - 1] ?? '';
  if (!permalink) {
    return {};
  }

  const [streetPart, cityPart, statePart, zipPart] = permalink.split('_');
  const toWords = (value: string | undefined): string | undefined => {
    if (!value) {
      return undefined;
    }
    return value
      .split('-')
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(' ');
  };

  const address = toWords(streetPart);
  const city = toWords(cityPart);
  const state = statePart?.toUpperCase();
  const zip = zipPart?.match(/\d{5}/)?.[0];

  return {
    title: address && city && state ? `${address}, ${city}, ${state}${zip ? ` ${zip}` : ''}` : address,
    address,
    city,
    state,
    zip
  };
}

function parseListingDetails(propertyDetails: RealtorPropertyDetails): unknown {
  const details = propertyDetails.details ?? [];
  return details.map((entry) => ({
    category: entry.category ?? null,
    parent_category: entry.parent_category ?? null,
    text: entry.text ?? []
  }));
}

function parseFees(propertyDetails: RealtorPropertyDetails): unknown {
  const rentalInfo = (propertyDetails.details ?? []).find((entry) => entry.category === 'Rental Info');
  const feeText = rentalInfo?.text?.find((item) => item.toLowerCase().startsWith('monthly fees:'));
  return feeText ? { monthly_fees_text: feeText.replace(/^monthly fees:\s*/i, '') } : null;
}

function mapPropertyDetailsToListing(
  listingUrl: string,
  propertyDetails: RealtorPropertyDetails,
  rawPayload: unknown
): NormalizedListingInput {
  const fallbackAddress = extractAddressFromPermalink(listingUrl);
  const detailText = getDetailsText(propertyDetails);
  const petsFromPolicy =
    propertyDetails.pet_policy?.cats === true || propertyDetails.pet_policy?.dogs === true
      ? true
      : propertyDetails.pet_policy?.cats === false && propertyDetails.pet_policy?.dogs === false
        ? false
        : null;

  return {
    source: 'realtor',
    sourceListingId: propertyDetails.listing_id,
    sourcePropertyId: propertyDetails.property_id,
    listingUrl: toAbsoluteUrl(propertyDetails.href, REALTOR_BASE_URL) ?? listingUrl,
    title: fallbackAddress.title,
    address: fallbackAddress.address,
    city: fallbackAddress.city,
    state: fallbackAddress.state,
    zip: fallbackAddress.zip,
    rentPrice: parseRent(propertyDetails.list_price),
    bedrooms: parseNumber(propertyDetails.description?.beds),
    bathrooms: parseNumber(propertyDetails.description?.baths ?? propertyDetails.description?.baths_full),
    allowsPets: petsFromPolicy ?? inferPetsValue(detailText),
    hasFence: inferFenceValue(detailText),
    availableDate: normalizeAvailabilityDate(propertyDetails.availability?.date),
    sqft: parseInteger(propertyDetails.description?.sqft),
    descriptionText: propertyDetails.description?.text,
    managementCompany: propertyDetails.consumer_advertisers?.[0]?.name ?? undefined,
    landlordName: propertyDetails.listing_information?.landlord_full_name,
    photoCount: parseInteger(propertyDetails.photo_count),
    tags: propertyDetails.tags,
    listingDetails: parseListingDetails(propertyDetails),
    fees: parseFees(propertyDetails),
    popularity: propertyDetails.popularity ?? null,
    rawSnippet: detailText.slice(0, 700),
    rawPayload
  };
}

export function extractRealtorDetailUrlsFromSearchHtml(html: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();

  $('[data-listing-id][data-property-id] a[href*="/rentals/details/"], a[href*="/rentals/details/"]').each(
    (_, element) => {
      const href = $(element).attr('href');
      const absolute = toAbsoluteUrl(href, REALTOR_BASE_URL);
      if (absolute) {
        urls.add(absolute);
      }
    }
  );

  return [...urls];
}

export async function fetchAndParseRealtorListing(listingUrl: string): Promise<NormalizedListingInput | null> {
  const absoluteListingUrl = toAbsoluteUrl(listingUrl, REALTOR_BASE_URL);
  if (!absoluteListingUrl) {
    return null;
  }

  const html = await fetchHtml(absoluteListingUrl);
  const parsed = extractParsedDataFromNextData(html);
  const propertyDetails = parsed?.propertyDetails;
  if (!propertyDetails) {
    return null;
  }

  return mapPropertyDetailsToListing(absoluteListingUrl, propertyDetails, parsed);
}

function resolveSearchUrl(config: SearchConfig): string {
  const override = process.env['REALTOR_SEARCH_URL']?.trim();
  if (override) {
    return override;
  }
  const query = `${config.city}-${config.state}`.replace(/\s+/g, '-');
  return `${REALTOR_BASE_URL}/apartments/${query}`;
}

async function fetchListings(config: SearchConfig): Promise<NormalizedListingInput[]> {
  const searchUrl = resolveSearchUrl(config);
  const searchHtml = await fetchHtml(searchUrl);
  const listingUrls = extractRealtorDetailUrlsFromSearchHtml(searchHtml);
  if (listingUrls.length === 0) {
    return [];
  }

  const listings = await Promise.all(
    listingUrls.map(async (url) => {
      try {
        return await fetchAndParseRealtorListing(url);
      } catch {
        return null;
      }
    })
  );

  return listings.filter((listing): listing is NormalizedListingInput => Boolean(listing));
}

export const realtorAdapter: SourceAdapter = {
  source: 'realtor',
  fetchListings
};
