/* global browser */

const PRICE_TEXT_REGEX = /\$\s?\d[\d,]*/;
const BEDROOMS_REGEX = /(\d+(?:\.\d+)?)\s*(?:bd|bed|beds|bedroom|bedrooms)\b/i;
const BATHROOMS_REGEX = /(\d+(?:\.\d+)?)\s*(?:ba|bath|baths|bathroom|bathrooms)\b/i;
const TRULIA_LISTING_PATH_REGEX = /\/(for_rent|p|property|home)\//i;
const REALTOR_LISTING_PATH_REGEX = /\/rentals\/details\//i;
const BAD_HREF_REGEX = /^(#|javascript:|mailto:|tel:)/i;

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

function getPreferredAnchor(container, source) {
  if (!container) {
    return null;
  }

  const anchors = [...container.querySelectorAll('a[href]')];
  if (anchors.length === 0) {
    return null;
  }

  if (source !== 'trulia') {
    return anchors[0];
  }

  let bestAnchor = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  anchors.forEach((anchor) => {
    const href = normalizeText(anchor.getAttribute('href') ?? '');
    if (!href || BAD_HREF_REGEX.test(href)) {
      return;
    }

    const anchorText = normalizeText(anchor.textContent);
    let score = 0;
    if (TRULIA_LISTING_PATH_REGEX.test(href)) {
      score += 20;
    }
    if (PRICE_TEXT_REGEX.test(anchorText)) {
      score += 2;
    }
    if (anchorText.length > 8) {
      score += 1;
    }
    if (href.startsWith('/')) {
      score += 1;
    }

    if (score > bestScore) {
      bestAnchor = anchor;
      bestScore = score;
    }
  });

  return bestAnchor ?? anchors[0];
}

function getTextFromSelectors(container, selectors) {
  for (const selector of selectors) {
    const element = container.querySelector(selector);
    const value = normalizeText(element ? element.textContent : '');
    if (value) {
      return value;
    }
  }
  return '';
}

function getFallbackTitle(containerText) {
  const tokens = containerText
    .split(/\s{2,}|\n+/)
    .map((value) => normalizeText(value))
    .filter(Boolean);
  return (
    tokens.find((value) => !PRICE_TEXT_REGEX.test(value) && /[a-z]/i.test(value) && value.length > 10) ??
    ''
  );
}

function parseListingFromContainer(anchor, container, source = null) {
  const containerText = normalizeText(container ? container.innerText : anchor?.textContent);
  if (!PRICE_TEXT_REGEX.test(containerText)) {
    return null;
  }

  const href = anchor?.getAttribute('href');
  const listingUrl = href ? toAbsoluteUrl(href) : null;
  if (!listingUrl) {
    return null;
  }

  const imageElement = container ? container.querySelector('img') : null;
  const explicitTitle = container
    ? getTextFromSelectors(container, ['[data-testid*="title"]', '[class*="title"]', 'h1', 'h2', 'h3'])
    : '';
  const anchorTitle = normalizeText(anchor?.textContent);
  const titleText = explicitTitle || anchorTitle || getFallbackTitle(containerText);
  const title = titleText ? titleText.slice(0, 200) : null;
  const explicitAddress = container
    ? getTextFromSelectors(container, ['[data-testid*="address"]', '[class*="address"]', '[class*="Address"]', 'address'])
    : '';
  const address = explicitAddress ? explicitAddress.slice(0, 240) : null;

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
      scannedFrom: window.location.href,
      source,
      containerTag: container?.tagName ?? null,
      containerClass: normalizeText(container?.className ?? '')
    }
  };
}

function scrapeTruliaListingsFromPage() {
  const deduped = new Map();
  const cards = document.querySelectorAll(
    'li, article, [data-testid*="card"], [class*="card"], [class*="Card"], [data-testid*="property"]'
  );

  cards.forEach((card) => {
    const cardText = normalizeText(card.innerText);
    if (!PRICE_TEXT_REGEX.test(cardText)) {
      return;
    }

    const anchor = getPreferredAnchor(card, 'trulia');
    if (!anchor) {
      return;
    }

    const listing = parseListingFromContainer(anchor, card, 'trulia');
    if (!listing) {
      return;
    }

    deduped.set(listing.listingUrl, listing);
  });

  if (deduped.size > 0) {
    return [...deduped.values()];
  }

  const anchors = document.querySelectorAll('a[href]');
  anchors.forEach((anchor) => {
    const container =
      anchor.closest('article, li, [data-testid*="card"], [class*="card"], [class*="Card"]') ?? anchor.parentElement;
    const listing = parseListingFromContainer(anchor, container, 'trulia');
    if (listing) {
      deduped.set(listing.listingUrl, listing);
    }
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

    const listing = parseListingFromContainer(anchor, card, 'forrent');
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

    const listing = parseListingFromContainer(anchor, card, 'zillow');
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

function scrapeRealtorListingsFromPage() {
  const deduped = new Map();
  const cards = document.querySelectorAll('[data-listing-id][data-property-id], [data-listing-id], [data-property-id]');

  cards.forEach((card) => {
    const listingId = normalizeText(card.getAttribute('data-listing-id') ?? '');
    const propertyId = normalizeText(card.getAttribute('data-property-id') ?? '');
    const anchor =
      card.querySelector('a[href*="/rentals/details/"]') ??
      [...card.querySelectorAll('a[href]')].find((item) => REALTOR_LISTING_PATH_REGEX.test(item.getAttribute('href') ?? ''));
    if (!anchor) {
      return;
    }

    const listingUrl = toAbsoluteUrl(anchor.getAttribute('href'));
    if (!listingUrl || !REALTOR_LISTING_PATH_REGEX.test(listingUrl)) {
      return;
    }

    const cardText = normalizeText(card.innerText);
    const imageElement = card.querySelector('img');
    const title =
      normalizeText(anchor.getAttribute('aria-label') ?? '') ||
      getTextFromSelectors(card, ['[data-testid*="card-title"]', '[class*="card-title"]', '[class*="title"]']) ||
      null;

    deduped.set(listingUrl, {
      listingUrl,
      sourceListingId: listingId || null,
      sourcePropertyId: propertyId || null,
      title,
      imageUrl: imageElement ? imageElement.src : null,
      rentPrice: parsePriceOrNull(cardText),
      bedrooms: parseFloatOrNull(cardText.match(BEDROOMS_REGEX)),
      bathrooms: parseFloatOrNull(cardText.match(BATHROOMS_REGEX)),
      rawSnippet: cardText.slice(0, 700),
      rawPayload: {
        scannedFrom: window.location.href,
        source: 'realtor',
        cardAttributes: {
          listingId: listingId || null,
          propertyId: propertyId || null
        }
      }
    });
  });

  if (deduped.size > 0) {
    return [...deduped.values()];
  }

  const links = document.querySelectorAll('a[href*="/rentals/details/"]');
  links.forEach((anchor) => {
    const listingUrl = toAbsoluteUrl(anchor.getAttribute('href'));
    if (!listingUrl || !REALTOR_LISTING_PATH_REGEX.test(listingUrl)) {
      return;
    }

    const container = anchor.closest('article, li, [data-listing-id], [class*="Card"], [class*="card"]') ?? anchor.parentElement;
    const containerText = normalizeText(container ? container.innerText : anchor.textContent);
    deduped.set(listingUrl, {
      listingUrl,
      sourceListingId: null,
      sourcePropertyId: null,
      title: normalizeText(anchor.getAttribute('aria-label') ?? '') || normalizeText(anchor.textContent) || null,
      imageUrl: container?.querySelector('img')?.src ?? null,
      rentPrice: parsePriceOrNull(containerText),
      bedrooms: parseFloatOrNull(containerText.match(BEDROOMS_REGEX)),
      bathrooms: parseFloatOrNull(containerText.match(BATHROOMS_REGEX)),
      rawSnippet: containerText.slice(0, 700),
      rawPayload: {
        scannedFrom: window.location.href,
        source: 'realtor'
      }
    });
  });

  return [...deduped.values()];
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
  if (hostname.includes('realtor.com')) {
    return 'realtor';
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
        : source === 'realtor'
          ? scrapeRealtorListingsFromPage()
          : scrapeTruliaListingsFromPage();
  return Promise.resolve({
    source,
    listings,
    count: listings.length
  });
});
