/* global browser */

const PRICE_TEXT_REGEX = /\$\s?\d[\d,]*/;
const BEDROOMS_REGEX = /(\d+(?:\.\d+)?)\s*(?:bd|bed|beds|bedroom|bedrooms)\b/i;
const BATHROOMS_REGEX = /(\d+(?:\.\d+)?)\s*(?:ba|bath|baths|bathroom|bathrooms)\b/i;

function normalizeText(value) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function parseFloatOrNull(matchResult) {
  if (!matchResult || !matchResult[1]) {
    return null;
  }
  const parsed = Number.parseFloat(matchResult[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePriceOrNull(text) {
  const match = normalizeText(text).match(PRICE_TEXT_REGEX);
  if (!match) {
    return null;
  }
  const numeric = Number.parseInt(match[0].replace(/[^\d]/g, ''), 10);
  return Number.isFinite(numeric) ? numeric : null;
}

function toAbsoluteUrl(urlValue) {
  try {
    return new URL(urlValue, window.location.origin).toString();
  } catch {
    return null;
  }
}

function parseListingFromContainer(anchor, container) {
  const containerText = normalizeText(container ? container.innerText : anchor.textContent);
  if (!PRICE_TEXT_REGEX.test(containerText)) {
    return null;
  }

  const href = anchor.getAttribute('href');
  const listingUrl = href ? toAbsoluteUrl(href) : null;
  if (!listingUrl) {
    return null;
  }

  const imageElement = container ? container.querySelector('img') : null;
  const title = normalizeText(anchor.textContent).slice(0, 200) || null;
  const addressElement = container
    ? container.querySelector('[data-testid*="address"], [class*="address"], address')
    : null;
  const address = normalizeText(addressElement ? addressElement.textContent : '').slice(0, 240) || null;

  return {
    listingUrl,
    title,
    address,
    city: null,
    state: null,
    zip: null,
    imageUrl: imageElement ? imageElement.src : null,
    rentPrice: parsePriceOrNull(containerText),
    bedrooms: parseFloatOrNull(containerText.match(BEDROOMS_REGEX)),
    bathrooms: parseFloatOrNull(containerText.match(BATHROOMS_REGEX)),
    rawSnippet: containerText.slice(0, 700),
    rawPayload: {
      scannedFrom: window.location.href
    }
  };
}

function scrapeTruliaListingsFromPage() {
  const deduped = new Map();
  const anchors = document.querySelectorAll('a[href]');

  anchors.forEach((anchor) => {
    const container =
      anchor.closest('article, li, [data-testid*="card"], [class*="card"], [class*="Card"]') ?? anchor.parentElement;
    const listing = parseListingFromContainer(anchor, container);
    if (!listing) {
      return;
    }

    deduped.set(listing.listingUrl, listing);
  });

  return [...deduped.values()];
}

function scrapeForRentListingsFromPage() {
  const deduped = new Map();
  const cards = document.querySelectorAll('[data-testid="property-card"], .property-card, article, li');

  cards.forEach((card) => {
    const anchor = card.querySelector('a[href]');
    if (!anchor) {
      return;
    }

    const listing = parseListingFromContainer(anchor, card);
    if (!listing) {
      return;
    }

    deduped.set(listing.listingUrl, listing);
  });

  return [...deduped.values()];
}

function scrapeZillowListingsFromPage() {
  const deduped = new Map();
  const cards = document.querySelectorAll(
    '[data-test="property-card"], [data-test*="property-card"], article, li, [class*="StyledPropertyCardDataArea"]'
  );

  cards.forEach((card) => {
    const anchor =
      card.querySelector('a[href*="/homedetails/"], a[href*="/b/"], a[href*="/apartments/"], a[href*="/rental-manager/"]') ??
      card.querySelector('a[href]');
    if (!anchor) {
      return;
    }

    const listing = parseListingFromContainer(anchor, card);
    if (!listing) {
      return;
    }

    deduped.set(listing.listingUrl, listing);
  });

  if (deduped.size > 0) {
    return [...deduped.values()];
  }

  return scrapeTruliaListingsFromPage();
}

function getSourceFromHostname() {
  const hostname = window.location.hostname.toLowerCase();
  if (hostname.includes('trulia.com')) {
    return 'trulia';
  }
  if (hostname.includes('forrent.com')) {
    return 'forrent';
  }
  if (hostname.includes('zillow.com')) {
    return 'zillow';
  }
  return null;
}

browser.runtime.onMessage.addListener((message) => {
  if (!message || (message.type !== 'SCAN_TRULIA_PAGE' && message.type !== 'SCAN_RENTAL_PAGE')) {
    return undefined;
  }

  const source = getSourceFromHostname();
  if (!source) {
    return Promise.resolve({
      source: null,
      listings: [],
      count: 0
    });
  }

  const listings =
    source === 'forrent'
      ? scrapeForRentListingsFromPage()
      : source === 'zillow'
        ? scrapeZillowListingsFromPage()
        : scrapeTruliaListingsFromPage();
  return Promise.resolve({
    source,
    listings,
    count: listings.length
  });
});
