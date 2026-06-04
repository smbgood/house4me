import * as cheerio from 'cheerio';

import { fetchHtml } from './http';
import { inferFenceValue, inferPetsValue, parseNumber, parseRent, toAbsoluteUrl } from './normalize';
import { type NormalizedListingInput, type SearchConfig, type SourceAdapter } from './types';

const BASE_URL = 'https://www.forrent.com';

function resolveSearchUrl(config: SearchConfig): string {
  const override = process.env['FORRENT_SEARCH_URL']?.trim();
  if (override) {
    return override;
  }

  const locality = config.zip ? `${config.city},${config.state},${config.zip}` : `${config.city},${config.state}`;
  const query = locality.replace(/\s+/g, '-');
  return `${BASE_URL}/find/${query}`;
}

function extractFromCards($: cheerio.CheerioAPI): NormalizedListingInput[] {
  const listings: NormalizedListingInput[] = [];

  $('[data-testid="property-card"], .property-card, article').each((_, element) => {
    const card = $(element);
    const link = card.find('a[href*="/"]').first().attr('href');
    const listingUrl = toAbsoluteUrl(link, BASE_URL);
    if (!listingUrl) {
      return;
    }

    const title = card.find('a, h2, h3').first().text().trim() || undefined;
    const address = card.find('[data-testid="property-address"], .property-address, .address').first().text().trim() || undefined;
    const rentText = card.text();

    listings.push({
      source: 'forrent',
      listingUrl,
      title,
      address,
      rentPrice: parseRent(rentText),
      bedrooms: parseNumber(card.find('[data-testid="beds"], .beds').first().text().trim()),
      bathrooms: parseNumber(card.find('[data-testid="baths"], .baths').first().text().trim()),
      allowsPets: inferPetsValue(rentText),
      hasFence: inferFenceValue(rentText),
      rawSnippet: rentText.slice(0, 700)
    });
  });

  return listings;
}

async function fetchListings(config: SearchConfig): Promise<NormalizedListingInput[]> {
  const searchUrl = resolveSearchUrl(config);
  const html = await fetchHtml(searchUrl);
  const $ = cheerio.load(html);

  const fromCards = extractFromCards($);
  if (fromCards.length > 0) {
    const deduped = new Map<string, NormalizedListingInput>();
    for (const listing of fromCards) {
      deduped.set(listing.listingUrl, listing);
    }
    return [...deduped.values()];
  }

  const fallbackText = $('body').text();
  const fallbackLink = $('a[href*="/"]').first().attr('href');
  const listingUrl = toAbsoluteUrl(fallbackLink, BASE_URL);

  if (!listingUrl) {
    return [];
  }

  return [
    {
      source: 'forrent',
      listingUrl,
      title: 'ForRent listing result',
      rentPrice: parseRent(fallbackText),
      allowsPets: inferPetsValue(fallbackText),
      hasFence: inferFenceValue(fallbackText),
      rawSnippet: fallbackText.slice(0, 700)
    }
  ];
}

export const forRentAdapter: SourceAdapter = {
  source: 'forrent',
  fetchListings
};
