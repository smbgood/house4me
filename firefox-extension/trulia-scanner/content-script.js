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

function scrapeListingsFromPage() {
  const deduped = new Map();
  const anchors = document.querySelectorAll('a[href]');

  anchors.forEach((anchor) => {
    const href = anchor.getAttribute('href');
    const listingUrl = href ? toAbsoluteUrl(href) : null;
    if (!listingUrl) {
      return;
    }

    const container =
      anchor.closest('article, li, [data-testid*="card"], [class*="card"], [class*="Card"]') ?? anchor.parentElement;
    const containerText = normalizeText(container ? container.innerText : anchor.textContent);

    if (!PRICE_TEXT_REGEX.test(containerText)) {
      return;
    }

    const imageElement = container ? container.querySelector('img') : null;
    const title = normalizeText(anchor.textContent).slice(0, 200) || null;
    const addressElement = container
      ? container.querySelector('[data-testid*="address"], [class*="address"], address')
      : null;
    const address = normalizeText(addressElement ? addressElement.textContent : '').slice(0, 240) || null;

    const listing = {
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

    deduped.set(listingUrl, listing);
  });

  return [...deduped.values()];
}

browser.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== 'SCAN_TRULIA_PAGE') {
    return undefined;
  }

  const listings = scrapeListingsFromPage();
  return Promise.resolve({
    listings,
    count: listings.length
  });
});
