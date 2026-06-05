/* global browser */

const PRICE_TEXT_REGEX = /\$\s?\d[\d,]*/;
const BEDROOMS_REGEX = /(\d+(?:\.\d+)?)\s*(?:bd|bed|beds|bedroom|bedrooms)\b/i;
const BATHROOMS_REGEX = /(\d+(?:\.\d+)?)\s*(?:ba|bath|baths|bathroom|bathrooms)\b/i;
const TRULIA_LISTING_PATH_REGEX = /\/(for_rent|p|property|home)\//i;
const REALTOR_LISTING_PATH_REGEX = /\/rentals\/details\//i;
const BAD_HREF_REGEX = /^(#|javascript:|mailto:|tel:)/i;
const FORRENT_BRIDGE_REQUEST_TYPE = 'HOUSE4ME_FORRENT_ENRICH_REQUEST';
const FORRENT_BRIDGE_RESPONSE_TYPE = 'HOUSE4ME_FORRENT_ENRICH_RESPONSE';
const FORRENT_BRIDGE_PROGRESS_TYPE = 'HOUSE4ME_FORRENT_ENRICH_PROGRESS';
const FORRENT_BRIDGE_SCRIPT_ID = 'house4me-forrent-enrichment-bridge';
const FORRENT_DETAIL_DELAY_MS = 3000;
const FORRENT_DETAIL_TIMEOUT_MS = 15000;
const FORRENT_ENRICHMENT_TIMEOUT_BUFFER_MS = 30000;

let activeForRentJobId = null;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

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

function mergeForRentListingDetails(listing, detail) {
  if (!detail || typeof detail !== 'object') {
    return listing;
  }

  return {
    ...listing,
    sourcePropertyId: typeof detail.sourcePropertyId === 'string' ? detail.sourcePropertyId : listing.sourcePropertyId ?? null,
    address: detail.address || listing.address || null,
    city: detail.city || listing.city || null,
    state: detail.state || listing.state || null,
    zip: detail.zip || listing.zip || null,
    rentPrice: Number.isFinite(detail.rentPrice) ? detail.rentPrice : listing.rentPrice ?? null,
    bedrooms: Number.isFinite(detail.bedrooms) ? detail.bedrooms : listing.bedrooms ?? null,
    bathrooms: Number.isFinite(detail.bathrooms) ? detail.bathrooms : listing.bathrooms ?? null,
    allowsPets: typeof detail.allowsPets === 'boolean' ? detail.allowsPets : listing.allowsPets ?? null,
    hasFence: typeof detail.hasFence === 'boolean' ? detail.hasFence : listing.hasFence ?? null,
    availableDate: typeof detail.availableDate === 'string' ? detail.availableDate : listing.availableDate ?? null,
    sqft: Number.isFinite(detail.sqft) ? detail.sqft : listing.sqft ?? null,
    descriptionText: typeof detail.descriptionText === 'string' ? detail.descriptionText : listing.descriptionText ?? null,
    managementCompany:
      typeof detail.managementCompany === 'string' ? detail.managementCompany : listing.managementCompany ?? null,
    landlordName: typeof detail.landlordName === 'string' ? detail.landlordName : listing.landlordName ?? null,
    photoCount: Number.isFinite(detail.photoCount) ? detail.photoCount : listing.photoCount ?? null,
    tags: Array.isArray(detail.tags) ? detail.tags : listing.tags ?? null,
    listingDetails: Array.isArray(detail.listingDetails) ? detail.listingDetails : listing.listingDetails ?? null,
    fees: isObject(detail.fees) ? detail.fees : listing.fees ?? null,
    popularity: isObject(detail.popularity) ? detail.popularity : listing.popularity ?? null,
    rawPayload: {
      ...(isObject(listing.rawPayload) ? listing.rawPayload : {}),
      detailFetched: detail.detailFetchStatus === 'success',
      detailFetchStatus: detail.detailFetchStatus ?? 'unknown',
      detailFetchError: detail.detailFetchError ?? null,
      detailParserSource: detail.detailParserSource ?? null,
      amenityExtractionDebug: isObject(detail.amenityExtractionDebug) ? detail.amenityExtractionDebug : null,
      detailFetchedAt: new Date().toISOString()
    }
  };
}

function createForRentEnrichmentRequestId() {
  return `forrent-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function calculateForRentEnrichmentTimeoutMs(totalListings) {
  const safeTotal = Number.isFinite(totalListings) ? Math.max(0, totalListings) : 0;
  const expectedMs = safeTotal * (FORRENT_DETAIL_DELAY_MS + FORRENT_DETAIL_TIMEOUT_MS) + FORRENT_ENRICHMENT_TIMEOUT_BUFFER_MS;
  return Math.max(120000, expectedMs);
}

function safeSendRuntimeMessage(message) {
  try {
    browser.runtime.sendMessage(message);
  } catch {
    // Popup may not be open; ignore failures.
  }
}

function ensureForRentEnrichmentBridgeInstalled() {
  if (document.getElementById(FORRENT_BRIDGE_SCRIPT_ID)) {
    return;
  }

  function installBridge() {
    if (window.__house4meForRentBridgeInstalled) {
      return;
    }
    window.__house4meForRentBridgeInstalled = true;

    function normalize(value) {
      return (value ?? '').replace(/\s+/g, ' ').trim();
    }

    function parseJsonSafely(raw) {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }

    function toNumber(value) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string') {
        const parsed = Number.parseFloat(value.replace(/[^\d.]/g, ''));
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    }

    function toInteger(value) {
      const parsed = toNumber(value);
      return Number.isFinite(parsed) ? Math.round(parsed) : null;
    }

    function toDate(value) {
      if (!value || typeof value !== 'string') {
        return null;
      }
      const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
      return match ? match[1] : null;
    }

    function firstString(...values) {
      for (const value of values) {
        if (typeof value === 'string') {
          const normalized = normalize(value);
          if (normalized) {
            return normalized;
          }
        }
      }
      return null;
    }

    function firstNumber(...values) {
      for (const value of values) {
        const parsed = toNumber(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
      return null;
    }

    function flattenStructuredData(value) {
      if (!value) {
        return [];
      }
      if (Array.isArray(value)) {
        return value.flatMap((item) => flattenStructuredData(item));
      }
      if (typeof value !== 'object') {
        return [];
      }
      const objectValue = value;
      const graph = objectValue['@graph'];
      if (Array.isArray(graph)) {
        return [objectValue, ...graph.flatMap((item) => flattenStructuredData(item))];
      }
      return [objectValue];
    }

    function findEmbeddedForRentProfile(value, depth = 0) {
      if (!value || depth > 14 || typeof value !== 'object') {
        return null;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = findEmbeddedForRentProfile(item, depth + 1);
          if (found) {
            return found;
          }
        }
        return null;
      }

      const objectValue = value;
      if (
        Array.isArray(objectValue.amenityGroups) ||
        Array.isArray(objectValue.amenities) ||
        Array.isArray(objectValue.communityFeatures)
      ) {
        return objectValue;
      }

      for (const key of Object.keys(objectValue)) {
        const found = findEmbeddedForRentProfile(objectValue[key], depth + 1);
        if (found) {
          return found;
        }
      }
      return null;
    }

    function extractEmbeddedForRentProfile(doc) {
      const candidates = [];

      const nextDataScript = doc.getElementById('__NEXT_DATA__');
      if (nextDataScript) {
        candidates.push({
          source: '__NEXT_DATA__',
          parsed: parseJsonSafely(nextDataScript.textContent || '')
        });
      }

      doc.querySelectorAll('script[type="application/json"]').forEach((script, index) => {
        candidates.push({
          source: `application/json-script-${index}`,
          parsed: parseJsonSafely(script.textContent || '')
        });
      });

      for (const candidate of candidates) {
        const profile = findEmbeddedForRentProfile(candidate.parsed);
        if (profile) {
          return {
            profile,
            source: candidate.source
          };
        }
      }

      return {
        profile: null,
        source: null
      };
    }

    function extractAmenitiesFromEmbeddedProfile(profile) {
      const rows = [];
      const amenityTags = new Set();
      const counts = {
        amenityGroups: 0,
        communityFeatures: 0,
        flatAmenities: 0
      };

      if (Array.isArray(profile.amenityGroups)) {
        profile.amenityGroups.forEach((group) => {
          if (!group || typeof group !== 'object') {
            return;
          }
          const items = Array.isArray(group.items)
            ? group.items.map((item) => normalize(item)).filter(Boolean)
            : [];
          if (items.length === 0) {
            return;
          }
          counts.amenityGroups += items.length;
          items.forEach((item) => amenityTags.add(item));
          rows.push({
            category: typeof group.categoryName === 'string' ? group.categoryName : 'Amenities',
            parent_category: 'Amenities',
            text: items
          });
        });
      }

      if (Array.isArray(profile.communityFeatures)) {
        const items = profile.communityFeatures
          .map((entry) => {
            if (typeof entry === 'string') {
              return normalize(entry);
            }
            if (entry && typeof entry === 'object' && typeof entry.name === 'string') {
              return normalize(entry.name);
            }
            return '';
          })
          .filter(Boolean);
        if (items.length > 0) {
          counts.communityFeatures = items.length;
          items.forEach((item) => amenityTags.add(item));
          rows.push({
            category: 'Community Features',
            parent_category: 'Amenities',
            text: items
          });
        }
      }

      if (Array.isArray(profile.amenities)) {
        const byCategory = new Map();
        profile.amenities.forEach((entry) => {
          if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string') {
            return;
          }
          const name = normalize(entry.name);
          if (!name) {
            return;
          }
          counts.flatAmenities += 1;
          amenityTags.add(name);
          const category = typeof entry.categoryName === 'string' ? entry.categoryName : 'Amenities';
          if (!byCategory.has(category)) {
            byCategory.set(category, []);
          }
          byCategory.get(category).push(name);
        });

        byCategory.forEach((items, category) => {
          const alreadyPresent = rows.some((row) => row.category === category);
          if (!alreadyPresent) {
            rows.push({
              category,
              parent_category: 'Amenities',
              text: items
            });
          }
        });
      }

      return {
        rows,
        amenityTags: [...amenityTags],
        counts
      };
    }

    function mergeListingDetailRows(primaryRows, secondaryRows) {
      const merged = [];
      const seen = new Set();

      [...primaryRows, ...secondaryRows].forEach((row) => {
        if (!row || typeof row !== 'object' || !Array.isArray(row.text) || row.text.length === 0) {
          return;
        }
        const category = typeof row.category === 'string' ? row.category : 'Details';
        const parentCategory = typeof row.parent_category === 'string' ? row.parent_category : 'General';
        const text = [...new Set(row.text.map((item) => normalize(item)).filter(Boolean))];
        if (text.length === 0) {
          return;
        }
        const key = `${category}::${parentCategory}::${text.join('|')}`;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        merged.push({
          category,
          parent_category: parentCategory,
          text
        });
      });

      return merged;
    }

    function extractAmenityListItemsFromSection(doc, sectionQaid) {
      const selector = `section[data-qaid="${sectionQaid}"] li[data-qaid="listingAmenityListItem"]`;
      return [...doc.querySelectorAll(selector)]
        .map((element) => normalize(element.textContent))
        .filter(Boolean);
    }

    function extractTextListingDetails(doc) {
      const rows = [];
      const amenityTags = new Set();
      let propertyDetailsCount = 0;

      const communityFeatureItems = extractAmenityListItemsFromSection(doc, 'communityFeatures');
      if (communityFeatureItems.length > 0) {
        communityFeatureItems.forEach((item) => amenityTags.add(item));
        rows.push({
          category: 'Community Features',
          parent_category: 'Amenities',
          text: communityFeatureItems
        });
      }

      const amenityItems = extractAmenityListItemsFromSection(doc, 'amenities');
      if (amenityItems.length > 0) {
        amenityItems.forEach((item) => amenityTags.add(item));
        rows.push({
          category: 'Amenities',
          parent_category: 'Amenities',
          text: amenityItems
        });
      }

      doc.querySelectorAll('dl').forEach((dl) => {
        const entries = [];
        const terms = dl.querySelectorAll('dt');
        terms.forEach((term) => {
          const next = term.nextElementSibling;
          const label = normalize(term.textContent);
          const value = normalize(next ? next.textContent : '');
          if (label && value) {
            entries.push(`${label}: ${value}`);
          }
        });
        if (entries.length > 0) {
          propertyDetailsCount += entries.length;
          rows.push({
            category: 'Property Details',
            parent_category: 'General',
            text: entries
          });
        }
      });

      const amenityText = [...doc.querySelectorAll('[class*="amenit"], [data-testid*="amenit"] li, [aria-label*="amenit"] li')]
        .map((element) => normalize(element.textContent))
        .filter(Boolean)
        .filter((item) => !amenityTags.has(item))
        .slice(0, 30);
      if (amenityText.length > 0) {
        amenityText.forEach((item) => amenityTags.add(item));
        rows.push({
          category: 'Amenities (Fallback)',
          parent_category: 'General',
          text: amenityText
        });
      }

      return {
        rows,
        amenityTags: [...amenityTags],
        counts: {
          communityFeatures: communityFeatureItems.length,
          amenitiesSection: amenityItems.length,
          propertyDetails: propertyDetailsCount,
          fallbackAmenities: amenityText.length
        }
      };
    }

    function parseForRentDetail(htmlText, listingUrl) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');
      const bodyText = normalize(doc.body ? doc.body.innerText : '');
      const structuredData = [];
      doc.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
        const parsed = parseJsonSafely(script.textContent || '');
        flattenStructuredData(parsed).forEach((entry) => structuredData.push(entry));
      });

      const listingEntity =
        structuredData.find((entry) => {
          const typeValue = entry && typeof entry === 'object' ? entry['@type'] : null;
          if (typeof typeValue === 'string') {
            return /apartment|residence|house|offer|product/i.test(typeValue);
          }
          if (Array.isArray(typeValue)) {
            return typeValue.some((value) => /apartment|residence|house|offer|product/i.test(String(value)));
          }
          return false;
        }) ?? {};

      const listingAddress = listingEntity.address && typeof listingEntity.address === 'object' ? listingEntity.address : {};
      const listingOffers = listingEntity.offers && typeof listingEntity.offers === 'object' ? listingEntity.offers : {};
      const imageValue = listingEntity.image;
      const imageCount = Array.isArray(imageValue) ? imageValue.length : imageValue ? 1 : null;

      const bedsFromText = bodyText.match(/(\d+(?:\.\d+)?)\s*(?:bed|beds|bedroom|bedrooms)\b/i);
      const bathsFromText = bodyText.match(/(\d+(?:\.\d+)?)\s*(?:bath|baths|bathroom|bathrooms)\b/i);
      const sqftFromText = bodyText.match(/(\d[\d,]*)\s*(?:sq\.?\s*ft|square feet)\b/i);
      const feeFromText = bodyText.match(/(?:monthly fees?|fees?)[:\s]+([^.]+)/i);

      const description =
        firstString(
          listingEntity.description,
          doc.querySelector('meta[name="description"]')?.getAttribute('content'),
          doc.querySelector('[data-testid*="description"]')?.textContent
        ) ?? null;

      const embeddedProfileResult = extractEmbeddedForRentProfile(doc);
      const embeddedProfile = embeddedProfileResult.profile;
      const embeddedExtraction = embeddedProfile
        ? extractAmenitiesFromEmbeddedProfile(embeddedProfile)
        : { rows: [], amenityTags: [], counts: { amenityGroups: 0, communityFeatures: 0, flatAmenities: 0 } };
      const domExtraction = extractTextListingDetails(doc);
      const detailRows = mergeListingDetailRows(embeddedExtraction.rows, domExtraction.rows);
      const amenityTags = [
        ...new Set([...embeddedExtraction.amenityTags, ...domExtraction.amenityTags].map((item) => normalize(item)).filter(Boolean))
      ];
      const amenityExtractionDebug = {
        embeddedProfileSource: embeddedProfileResult.source,
        embeddedProfileFound: Boolean(embeddedProfile),
        htmlHasNextData: Boolean(doc.getElementById('__NEXT_DATA__')),
        htmlHasAmenityGroupsText: htmlText.includes('"amenityGroups"'),
        embeddedAmenityGroupItemCount: embeddedExtraction.counts.amenityGroups,
        embeddedCommunityFeatureCount: embeddedExtraction.counts.communityFeatures,
        embeddedFlatAmenityCount: embeddedExtraction.counts.flatAmenities,
        domCommunityFeatureCount: domExtraction.counts.communityFeatures,
        domAmenitySectionCount: domExtraction.counts.amenitiesSection,
        domPropertyDetailsCount: domExtraction.counts.propertyDetails,
        domFallbackAmenityCount: domExtraction.counts.fallbackAmenities,
        totalListingDetailRows: detailRows.length,
        totalAmenityTags: amenityTags.length,
        extractionStrategy:
          embeddedExtraction.rows.length > 0
            ? domExtraction.rows.length > 0
              ? 'embedded-json+dom'
              : 'embedded-json'
            : domExtraction.rows.length > 0
              ? 'dom-only'
              : 'none'
      };

      console.info('[house4me/forrent] amenity extraction', listingUrl, amenityExtractionDebug);

      const tags = [
        ...new Set(
          [...amenityTags, ...detailRows.flatMap((detail) => detail.text || [])]
            .map((item) => normalize(item))
            .filter(Boolean)
            .slice(0, 30)
        )
      ];

      const allowsPets = /\bpet(?:s)?\s*(?:friendly|allowed|welcome)\b/i.test(bodyText)
        ? true
        : /\bno pets\b/i.test(bodyText)
          ? false
          : null;
      const hasFence = /\bfenc(?:e|ed|ing)\b/i.test(bodyText) ? true : null;
      const sourcePropertyId =
        firstString(
          listingEntity.identifier,
          doc.querySelector('meta[property="og:url"]')?.getAttribute('content')?.match(/\/(\d+)(?:\?|$)/)?.[1]
        ) ?? null;

      return {
        sourcePropertyId,
        address: firstString(
          listingAddress.streetAddress,
          doc.querySelector('[data-testid*="address"]')?.textContent
        ),
        city: firstString(listingAddress.addressLocality),
        state: firstString(listingAddress.addressRegion),
        zip: firstString(listingAddress.postalCode),
        rentPrice: firstNumber(listingOffers.price, doc.querySelector('[data-testid*="rent"]')?.textContent),
        bedrooms: firstNumber(listingEntity.numberOfRooms, bedsFromText ? bedsFromText[1] : null),
        bathrooms: firstNumber(listingEntity.numberOfBathroomsTotal, bathsFromText ? bathsFromText[1] : null),
        allowsPets,
        hasFence,
        availableDate: toDate(listingOffers.availabilityStarts),
        sqft: toInteger(
          listingEntity.floorSize && typeof listingEntity.floorSize === 'object'
            ? listingEntity.floorSize.value
            : listingEntity.floorSize || (sqftFromText ? sqftFromText[1] : null)
        ),
        descriptionText: description,
        managementCompany: firstString(
          listingEntity.brand && typeof listingEntity.brand === 'object' ? listingEntity.brand.name : null,
          listingEntity.provider && typeof listingEntity.provider === 'object' ? listingEntity.provider.name : null
        ),
        landlordName: firstString(
          listingEntity.seller && typeof listingEntity.seller === 'object' ? listingEntity.seller.name : null
        ),
        photoCount: toInteger(imageCount),
        tags: tags.length > 0 ? tags : null,
        listingDetails: detailRows.length > 0 ? detailRows : null,
        fees: feeFromText ? { summary: normalize(feeFromText[1]).slice(0, 240) } : null,
        popularity: null,
        detailParserSource: embeddedProfile
          ? embeddedProfileResult.source
          : structuredData.length > 0
            ? 'structured-data'
            : 'dom-fallback',
        amenityExtractionDebug,
        detailFetchStatus: 'success',
        detailFetchError: null,
        listingUrl
      };
    }

    async function fetchDetailWithTimeout(url, timeoutMs) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return await response.text();
      } finally {
        clearTimeout(timeoutId);
      }
    }

    async function enrichListingUrls(listingUrls, requestId) {
      const detailByUrl = {};
      const total = listingUrls.length;
      let completed = 0;
      const timeoutMs = FORRENT_DETAIL_TIMEOUT_MS;

      function delay(ms) {
        return new Promise((resolve) => {
          setTimeout(resolve, ms);
        });
      }

      for (let index = 0; index < listingUrls.length; index += 1) {
        const listingUrl = listingUrls[index];
        let detailResult;
        try {
          const htmlText = await fetchDetailWithTimeout(listingUrl, timeoutMs);
          detailResult = parseForRentDetail(htmlText, listingUrl);
        } catch (error) {
          detailResult = {
            listingUrl,
            detailFetchStatus: error && error.name === 'AbortError' ? 'timeout' : 'error',
            detailFetchError: error instanceof Error ? error.message : String(error || 'Detail fetch failed')
          };
        }

        detailByUrl[listingUrl] = detailResult;
        completed += 1;
        window.postMessage(
          {
            type: 'HOUSE4ME_FORRENT_ENRICH_PROGRESS',
            requestId,
            completed,
            total,
            listingUrl,
            detailFetchStatus: detailResult.detailFetchStatus || 'unknown',
            amenityTagCount:
              detailResult.amenityExtractionDebug && Number.isFinite(detailResult.amenityExtractionDebug.totalAmenityTags)
                ? detailResult.amenityExtractionDebug.totalAmenityTags
                : null,
            amenityExtractionStrategy:
              detailResult.amenityExtractionDebug && typeof detailResult.amenityExtractionDebug.extractionStrategy === 'string'
                ? detailResult.amenityExtractionDebug.extractionStrategy
                : null
          },
          window.location.origin
        );

        if (index < listingUrls.length - 1) {
          await delay(FORRENT_DETAIL_DELAY_MS);
        }
      }

      return detailByUrl;
    }

    window.addEventListener('message', async (event) => {
      if (event.source !== window) {
        return;
      }
      const data = event.data;
      if (!data || data.type !== 'HOUSE4ME_FORRENT_ENRICH_REQUEST') {
        return;
      }

      const requestId = typeof data.requestId === 'string' ? data.requestId : '';
      const listingUrls = Array.isArray(data.listingUrls)
        ? data.listingUrls.filter((entry) => typeof entry === 'string' && /^https?:\/\//i.test(entry))
        : [];

      const detailByUrl = await enrichListingUrls(listingUrls, requestId);
      window.postMessage(
        {
          type: 'HOUSE4ME_FORRENT_ENRICH_RESPONSE',
          requestId,
          detailByUrl
        },
        window.location.origin
      );
    });
  }

  const script = document.createElement('script');
  script.id = FORRENT_BRIDGE_SCRIPT_ID;
  script.textContent = `(${installBridge.toString()})();`;
  (document.head || document.documentElement || document.body).appendChild(script);
  script.remove();
}

function enrichForRentListingsViaScriptlet(listings, options = {}) {
  if (!Array.isArray(listings) || listings.length === 0) {
    return Promise.resolve({
      listings: [],
      enrichment: {
        attempted: 0,
        succeeded: 0,
        failed: 0
      }
    });
  }

  ensureForRentEnrichmentBridgeInstalled();

  const requestId = typeof options.requestId === 'string' && options.requestId ? options.requestId : createForRentEnrichmentRequestId();
  const dedupedUrls = [...new Set(listings.map((listing) => listing?.listingUrl).filter((url) => typeof url === 'string'))];
  const timeoutMs = calculateForRentEnrichmentTimeoutMs(dedupedUrls.length);

  return new Promise((resolve) => {
    let timeoutId = null;

    function finalize(detailByUrl) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      window.removeEventListener('message', handleWindowMessage);
      const mergedListings = listings.map((listing) => mergeForRentListingDetails(listing, detailByUrl[listing.listingUrl]));
      const statuses = Object.values(detailByUrl).map((entry) =>
        entry && typeof entry === 'object' ? entry.detailFetchStatus : null
      );
      const succeeded = statuses.filter((status) => status === 'success').length;
      const amenityDiagnostics = mergedListings.reduce(
        (summary, listing) => {
          const debug = listing.rawPayload?.amenityExtractionDebug;
          if (debug && debug.totalAmenityTags > 0) {
            summary.withAmenities += 1;
          } else {
            summary.withoutAmenities += 1;
          }
          return summary;
        },
        { withAmenities: 0, withoutAmenities: 0 }
      );
      console.info('[house4me/forrent] enrichment amenity summary', amenityDiagnostics);
      resolve({
        listings: mergedListings,
        enrichment: {
          attempted: dedupedUrls.length,
          succeeded,
          failed: dedupedUrls.length - succeeded,
          amenityDiagnostics
        }
      });
    }

    function handleWindowMessage(event) {
      if (event.source !== window) {
        return;
      }
      const data = event.data;
      if (!data || data.requestId !== requestId) {
        return;
      }
      if (data.type === FORRENT_BRIDGE_PROGRESS_TYPE) {
        const progressCompleted = Number.isFinite(data.completed) ? data.completed : 0;
        const progressTotal = Number.isFinite(data.total) ? data.total : dedupedUrls.length;
        if (typeof options.onProgress === 'function') {
          options.onProgress({
            completed: progressCompleted,
            total: progressTotal,
            listingUrl: typeof data.listingUrl === 'string' ? data.listingUrl : null,
            detailFetchStatus: typeof data.detailFetchStatus === 'string' ? data.detailFetchStatus : 'unknown'
          });
        }
        if (!options.suppressRuntimeProgress) {
          safeSendRuntimeMessage({
            type: 'FORRENT_ENRICH_PROGRESS',
            requestId,
            completed: progressCompleted,
            total: progressTotal
          });
        }
        return;
      }
      if (data.type === FORRENT_BRIDGE_RESPONSE_TYPE) {
        const detailByUrl = isObject(data.detailByUrl) ? data.detailByUrl : {};
        finalize(detailByUrl);
      }
    }

    window.addEventListener('message', handleWindowMessage);
    timeoutId = setTimeout(() => {
      const fallbackDetails = {};
      dedupedUrls.forEach((listingUrl) => {
        fallbackDetails[listingUrl] = {
          listingUrl,
          detailFetchStatus: 'timeout',
          detailFetchError: 'Enrichment bridge timed out.'
        };
      });
      finalize(fallbackDetails);
    }, timeoutMs);

    window.postMessage(
      {
        type: FORRENT_BRIDGE_REQUEST_TYPE,
        requestId,
        listingUrls: dedupedUrls
      },
      window.location.origin
    );
  });
}

function startForRentEnrichmentJob(jobId, listings) {
  const normalizedListings = Array.isArray(listings) ? listings.filter((listing) => listing && typeof listing === 'object') : [];
  const total = normalizedListings.length;
  activeForRentJobId = jobId;

  safeSendRuntimeMessage({
    type: 'FORRENT_ENRICH_STARTED',
    jobId,
    total
  });

  void enrichForRentListingsViaScriptlet(normalizedListings, {
    requestId: jobId,
    suppressRuntimeProgress: true,
    onProgress(progress) {
      safeSendRuntimeMessage({
        type: 'FORRENT_ENRICH_PROGRESS',
        jobId,
        completed: progress.completed,
        total: progress.total,
        listingUrl: progress.listingUrl,
        detailFetchStatus: progress.detailFetchStatus
      });
    }
  })
    .then((result) => {
      safeSendRuntimeMessage({
        type: 'FORRENT_ENRICH_COMPLETE',
        jobId,
        total,
        completed: total,
        listings: result.listings,
        enrichment: result.enrichment
      });
    })
    .catch((error) => {
      safeSendRuntimeMessage({
        type: 'FORRENT_ENRICH_ERROR',
        jobId,
        error: error instanceof Error ? error.message : String(error || 'Unknown enrichment error'),
        total
      });
    })
    .finally(() => {
      if (activeForRentJobId === jobId) {
        activeForRentJobId = null;
      }
    });
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
  if (!message) {
    return undefined;
  }

  if (message.type === 'START_FORRENT_ENRICHMENT') {
    const source = getSourceFromHostname();
    if (source !== 'forrent') {
      return Promise.resolve({
        ok: false,
        error: 'ForRent enrichment can only run on a ForRent tab.'
      });
    }
    if (activeForRentJobId) {
      return Promise.resolve({
        ok: false,
        error: 'A ForRent enrichment job is already running.',
        jobId: activeForRentJobId
      });
    }

    const incomingListings = Array.isArray(message.listings) ? message.listings : [];
    const jobId =
      typeof message.jobId === 'string' && message.jobId.trim().length > 0
        ? message.jobId.trim()
        : createForRentEnrichmentRequestId();
    startForRentEnrichmentJob(jobId, incomingListings);
    return Promise.resolve({
      ok: true,
      jobId,
      total: incomingListings.length
    });
  }

  if (message.type !== 'SCAN_TRULIA_PAGE' && message.type !== 'SCAN_RENTAL_PAGE') {
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

  if (source === 'forrent') {
    const listings = scrapeForRentListingsFromPage();
    return Promise.resolve({
      source,
      listings,
      count: listings.length
    });
  }

  const listings =
    source === 'zillow'
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
