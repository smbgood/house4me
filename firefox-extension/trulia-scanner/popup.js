/* global browser, House4MeConfig */

const statusEl = document.getElementById('status');
const scanButton = document.getElementById('scanButton');
const optionsButton = document.getElementById('optionsButton');
const listSelect = document.getElementById('listSelect');
const refreshListsButton = document.getElementById('refreshListsButton');
const newListNameInput = document.getElementById('newListNameInput');
const createListButton = document.getElementById('createListButton');

const MAIN_LIST_SLUG = 'main';
const LISTS_STORAGE_KEY = 'selectedImportListSlug';
const MESSAGE_TARGET_BACKGROUND = 'house4me-background';
const MESSAGE_TARGET_POPUP = 'house4me-popup';
const GET_ENRICHMENT_EVENT_MESSAGE_TYPE = 'HOUSE4ME_GET_ENRICHMENT_EVENT';
const ENRICHMENT_START_TYPES = new Set(['FORRENT_ENRICH_STARTED', 'TRULIA_ENRICH_STARTED']);

let currentSource = null;
let currentLists = [{ slug: MAIN_LIST_SLUG, name: 'Main' }];
let selectedListSlug = MAIN_LIST_SLUG;
let activeEnrichmentJob = null;

function setStatus(message) {
  statusEl.textContent = message;
}

async function getSettings() {
  const values = await browser.storage.local.get([
    'ingestToken',
    'truliaIngestToken',
    'forrentIngestToken',
    'zillowIngestToken',
    'realtorIngestToken',
    LISTS_STORAGE_KEY
  ]);
  return {
    truliaIngestToken:
      typeof values.truliaIngestToken === 'string'
        ? values.truliaIngestToken.trim()
        : typeof values.ingestToken === 'string'
          ? values.ingestToken.trim()
          : '',
    forrentIngestToken: typeof values.forrentIngestToken === 'string' ? values.forrentIngestToken.trim() : '',
    zillowIngestToken: typeof values.zillowIngestToken === 'string' ? values.zillowIngestToken.trim() : '',
    realtorIngestToken: typeof values.realtorIngestToken === 'string' ? values.realtorIngestToken.trim() : '',
    selectedImportListSlug:
      typeof values[LISTS_STORAGE_KEY] === 'string' ? values[LISTS_STORAGE_KEY].trim().toLowerCase() : MAIN_LIST_SLUG
  };
}

async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function getSourceFromUrl(url) {
  if (!url) {
    return null;
  }
  if (url.includes('trulia.com')) {
    return 'trulia';
  }
  if (url.includes('forrent.com')) {
    return 'forrent';
  }
  if (url.includes('zillow.com')) {
    return 'zillow';
  }
  if (url.includes('realtor.com')) {
    return 'realtor';
  }
  return null;
}

function getTokenForSource(settings, source) {
  if (source === 'trulia') {
    return settings.truliaIngestToken;
  }
  if (source === 'forrent') {
    return settings.forrentIngestToken;
  }
  if (source === 'zillow') {
    return settings.zillowIngestToken;
  }
  if (source === 'realtor') {
    return settings.realtorIngestToken;
  }
  return '';
}

function setListSelectOptions(lists) {
  currentLists = lists.length > 0 ? lists : [{ slug: MAIN_LIST_SLUG, name: 'Main' }];
  listSelect.innerHTML = '';
  currentLists.forEach((list) => {
    const option = document.createElement('option');
    option.value = list.slug;
    option.textContent = list.name;
    listSelect.append(option);
  });

  const exists = currentLists.some((list) => list.slug === selectedListSlug);
  if (!exists) {
    selectedListSlug = MAIN_LIST_SLUG;
  }
  listSelect.value = selectedListSlug;
}

async function saveSelectedListSlug(slug) {
  selectedListSlug = slug || MAIN_LIST_SLUG;
  await browser.storage.local.set({
    [LISTS_STORAGE_KEY]: selectedListSlug
  });
}

async function fetchListingLists(settings, source) {
  const ingestToken = getTokenForSource(settings, source);
  if (!ingestToken) {
    return {
      ok: false,
      error: `Missing ${source} ingest token. Open options and configure it first.`
    };
  }

  const listsUrl = new URL('.netlify/functions/get-listing-lists', House4MeConfig.INGEST_BASE_URL).href;
  const response = await fetch(listsUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${ingestToken}`
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      error: payload.error ?? `Failed to load lists (${response.status}).`
    };
  }

  const lists = Array.isArray(payload.lists)
    ? payload.lists
        .map((row) => ({
          slug: typeof row.slug === 'string' ? row.slug : '',
          name: typeof row.name === 'string' ? row.name : ''
        }))
        .filter((row) => row.slug && row.name)
    : [];

  return {
    ok: true,
    lists
  };
}

async function loadListsForActiveSource({ showReadyMessage = false } = {}) {
  const settings = await getSettings();
  const tab = await getActiveTab();
  if (!tab || !tab.url) {
    setStatus('Unable to determine active tab.');
    return;
  }

  const source = getSourceFromUrl(tab.url);
  if (!source) {
    currentSource = null;
    setListSelectOptions([{ slug: MAIN_LIST_SLUG, name: 'Main' }]);
    setStatus('Active tab must be on Trulia, ForRent, Zillow, or Realtor.com.');
    return;
  }
  currentSource = source;
  selectedListSlug = settings.selectedImportListSlug || MAIN_LIST_SLUG;

  try {
    const result = await fetchListingLists(settings, source);
    if (!result.ok) {
      setListSelectOptions([{ slug: MAIN_LIST_SLUG, name: 'Main' }]);
      setStatus(result.error);
      return;
    }
    setListSelectOptions(result.lists);
    await saveSelectedListSlug(listSelect.value || MAIN_LIST_SLUG);
    if (showReadyMessage) {
      setStatus(`Ready. Importing to "${listSelect.selectedOptions[0]?.textContent ?? 'Main'}".`);
    }
  } catch (error) {
    setListSelectOptions([{ slug: MAIN_LIST_SLUG, name: 'Main' }]);
    setStatus(`Failed to load lists: ${String(error)}`);
  }
}

async function createListForActiveSource() {
  const listName = newListNameInput.value.trim();
  if (!listName) {
    setStatus('Enter a list name first.');
    return;
  }

  const settings = await getSettings();
  const tab = await getActiveTab();
  const source = tab?.url ? getSourceFromUrl(tab.url) : null;
  if (!source) {
    setStatus('Active tab must be on Trulia, ForRent, Zillow, or Realtor.com.');
    return;
  }

  const ingestToken = getTokenForSource(settings, source);
  if (!ingestToken) {
    setStatus(`Missing ${source} ingest token. Open options and configure it first.`);
    return;
  }

  const createUrl = new URL('.netlify/functions/create-listing-list', House4MeConfig.INGEST_BASE_URL).href;
  createListButton.disabled = true;
  setStatus(`Creating list "${listName}"...`);
  try {
    const response = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ingestToken}`
      },
      body: JSON.stringify({ name: listName })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus(`Create list failed (${response.status}): ${payload.error ?? 'Unknown error'}`);
      return;
    }

    const createdSlug = typeof payload?.list?.slug === 'string' ? payload.list.slug : '';
    await loadListsForActiveSource();
    if (createdSlug) {
      listSelect.value = createdSlug;
      await saveSelectedListSlug(createdSlug);
    }
    newListNameInput.value = '';
    setStatus(`List created: ${payload?.list?.name ?? listName}`);
  } catch (error) {
    setStatus(`Create list request failed: ${String(error)}`);
  } finally {
    createListButton.disabled = false;
  }
}

async function ingestListings({
  source,
  listings,
  selectedSlug,
  selectedListLabel,
  ingestToken,
  enrichmentSummary
}) {
  setStatus(`Found ${listings.length} ${source} listings. Sending...`);
  const requestBody = {
    listings
  };
  if (selectedSlug !== MAIN_LIST_SLUG) {
    requestBody.listSlug = selectedSlug;
  }

  const response = await fetch(House4MeConfig.getIngestUrl(source), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ingestToken}`
    },
    body: JSON.stringify(requestBody)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Ingest failed (${response.status}): ${payload.error ?? 'Unknown error'}`);
  }

  if (payload.status === 'queued') {
    const runId = typeof payload.runId === 'string' ? payload.runId : 'unknown';
    const shortRunId = runId.length > 8 ? runId.slice(0, 8) : runId;
    setStatus(
      `Ingest queued.
Run: ${shortRunId}
List: ${selectedListLabel}
Received: ${payload.received ?? '?'}
Accepted: ${payload.accepted ?? '?'}
Rejected: ${payload.rejected ?? '?'}`
    );
    return;
  }

  const enrichmentText =
    (source === 'forrent' || source === 'trulia') && enrichmentSummary
      ? `
Enriched: ${enrichmentSummary.succeeded ?? '?'} / ${enrichmentSummary.attempted ?? '?'}
Enrich Failed: ${enrichmentSummary.failed ?? '?'}
With Amenities: ${enrichmentSummary.amenityDiagnostics?.withAmenities ?? '?'}
Missing Amenities: ${enrichmentSummary.amenityDiagnostics?.withoutAmenities ?? '?'}`
      : '';

  setStatus(
    `Ingest complete.
List: ${selectedListLabel}
Received: ${payload.received ?? '?'}
Accepted: ${payload.accepted ?? '?'}
Upserted: ${payload.upserted ?? '?'}
Rejected: ${payload.rejected ?? '?'}${enrichmentText}${
      payload.amenityDiagnostics
        ? `
Ingest w/ Amenities: ${payload.amenityDiagnostics.withAmenityTags ?? '?'}
Ingest w/o Amenities: ${payload.amenityDiagnostics.withoutAmenityTags ?? '?'}`
        : ''
    }`
  );
}

async function requestLatestEnrichmentEvent(jobId) {
  try {
    return await browser.runtime.sendMessage({
      type: GET_ENRICHMENT_EVENT_MESSAGE_TYPE,
      target: MESSAGE_TARGET_BACKGROUND,
      jobId
    });
  } catch {
    return null;
  }
}

function syncActiveJobProgressFromBackground() {
  if (!activeEnrichmentJob?.jobId) {
    return;
  }
  void requestLatestEnrichmentEvent(activeEnrichmentJob.jobId).then((result) => {
    if (!result?.ok || !result.event) {
      return;
    }
    handleEnrichmentMessage(result.event);
  });
}

async function scanCurrentPage() {
  if (activeEnrichmentJob) {
    const sourceLabel = activeEnrichmentJob.source === 'forrent' ? 'ForRent' : 'Trulia';
    setStatus(`${sourceLabel} enrichment is already running.
Progress: ${activeEnrichmentJob.completed}/${activeEnrichmentJob.total}`);
    return;
  }

  scanButton.disabled = true;
  try {
    const settings = await getSettings();
    const tab = await getActiveTab();
    if (!tab || !tab.id || !tab.url) {
      setStatus('Unable to determine active tab.');
      return;
    }

    let source = getSourceFromUrl(tab.url);
    if (!source) {
      setStatus('Active tab must be on Trulia, ForRent, Zillow, or Realtor.com.');
      return;
    }
    currentSource = source;

    const ingestToken = getTokenForSource(settings, source);
    if (!ingestToken) {
      setStatus(`Missing ${source} ingest token. Open options and configure it first.`);
      return;
    }

    setStatus(source === 'forrent' ? 'Scanning ForRent page...' : `Scanning ${source} page...`);
    let scanResult;
    try {
      scanResult = await browser.tabs.sendMessage(tab.id, { type: 'SCAN_RENTAL_PAGE' });
    } catch (error) {
      setStatus(`Failed to scan page: ${String(error)}`);
      return;
    }

    if (!scanResult || !Array.isArray(scanResult.listings)) {
      setStatus('No scan result returned from page.');
      return;
    }

    if (scanResult.listings.length === 0) {
      setStatus('Scan completed but found 0 listings with price text.');
      return;
    }

    if (scanResult.source && scanResult.source !== source) {
      source = scanResult.source;
    }

    const selectedSlug = listSelect.value || MAIN_LIST_SLUG;
    await saveSelectedListSlug(selectedSlug);
    const selectedList = currentLists.find((list) => list.slug === selectedSlug);
    const selectedListLabel = selectedList?.name ?? 'Main';

    if (source !== 'forrent' && source !== 'trulia') {
      await ingestListings({
        source,
        listings: scanResult.listings,
        selectedSlug,
        selectedListLabel,
        ingestToken,
        enrichmentSummary: scanResult.enrichment ?? null
      });
      return;
    }

    const isForRent = source === 'forrent';
    const sourceLabel = isForRent ? 'ForRent' : 'Trulia';
    const requestedJobId = `${source}-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setStatus(`Found ${scanResult.listings.length} ${sourceLabel} listings.
Starting detail enrichment in background...`);

    let startResult;
    try {
      startResult = await browser.tabs.sendMessage(tab.id, {
        type: isForRent ? 'START_FORRENT_ENRICHMENT' : 'START_TRULIA_ENRICHMENT',
        jobId: requestedJobId,
        listings: scanResult.listings
      });
    } catch (error) {
      setStatus(`Failed to start ${sourceLabel} enrichment: ${String(error)}`);
      return;
    }

    if (!startResult?.ok) {
      setStatus(`Unable to start ${sourceLabel} enrichment: ${startResult?.error ?? 'Unknown error'}`);
      return;
    }

    activeEnrichmentJob = {
      jobId: startResult.jobId,
      tabId: tab.id,
      source,
      ingestToken,
      selectedSlug,
      selectedListLabel,
      total: Number.isFinite(startResult.total) ? startResult.total : scanResult.listings.length,
      completed: 0
    };
    scanButton.disabled = true;
    setStatus(`Scanning ${sourceLabel} page and enriching detail pages...
Progress: 0/${activeEnrichmentJob.total}
Rate limit: 1 request every 3000 ms`);
    syncActiveJobProgressFromBackground();
  } finally {
    if (!activeEnrichmentJob) {
      scanButton.disabled = false;
    }
  }
}

function handleEnrichmentMessage(message) {
  if (!message) {
    return;
  }
  if (!activeEnrichmentJob && !ENRICHMENT_START_TYPES.has(message.type)) {
    return;
  }

  if (message.type === 'FORRENT_ENRICH_STARTED' || message.type === 'TRULIA_ENRICH_STARTED') {
    if (!activeEnrichmentJob || message.jobId !== activeEnrichmentJob.jobId) {
      return;
    }
    const sourceLabel = activeEnrichmentJob.source === 'forrent' ? 'ForRent' : 'Trulia';
    const total = Number.isFinite(message.total) ? message.total : activeEnrichmentJob.total;
    activeEnrichmentJob.total = total;
    setStatus(`Scanning ${sourceLabel} page and enriching detail pages...
Progress: 0/${total}
Rate limit: 1 request every 3000 ms`);
    return;
  }

  if (message.type === 'FORRENT_ENRICH_PROGRESS' || message.type === 'TRULIA_ENRICH_PROGRESS') {
    if (!activeEnrichmentJob || message.jobId !== activeEnrichmentJob.jobId) {
      return;
    }
    const sourceLabel = activeEnrichmentJob.source === 'forrent' ? 'ForRent' : 'Trulia';
    const completed = Number.isFinite(message.completed) ? message.completed : 0;
    const total = Number.isFinite(message.total) ? message.total : activeEnrichmentJob.total;
    activeEnrichmentJob.completed = completed;
    activeEnrichmentJob.total = total;
    setStatus(`Scanning ${sourceLabel} page and enriching detail pages...
Progress: ${completed}/${total}
Rate limit: 1 request every 3000 ms`);
    return;
  }

  if (message.type === 'FORRENT_ENRICH_ERROR' || message.type === 'TRULIA_ENRICH_ERROR') {
    if (!activeEnrichmentJob || message.jobId !== activeEnrichmentJob.jobId) {
      return;
    }
    const sourceLabel = activeEnrichmentJob.source === 'forrent' ? 'ForRent' : 'Trulia';
    activeEnrichmentJob = null;
    scanButton.disabled = false;
    setStatus(`${sourceLabel} enrichment failed: ${message.error ?? 'Unknown error'}`);
    return;
  }

  if (message.type !== 'FORRENT_ENRICH_COMPLETE' && message.type !== 'TRULIA_ENRICH_COMPLETE') {
    return;
  }
  if (!activeEnrichmentJob || message.jobId !== activeEnrichmentJob.jobId) {
    return;
  }

  const sourceLabel = activeEnrichmentJob.source === 'forrent' ? 'ForRent' : 'Trulia';
  const finishedJob = activeEnrichmentJob;
  activeEnrichmentJob = null;
  setStatus(`${sourceLabel} enrichment complete.
Preparing ingest request...`);
  void ingestListings({
    source: finishedJob.source,
    listings: Array.isArray(message.listings) ? message.listings : [],
    selectedSlug: finishedJob.selectedSlug,
    selectedListLabel: finishedJob.selectedListLabel,
    ingestToken: finishedJob.ingestToken,
    enrichmentSummary: message.enrichment ?? null
  })
    .catch((error) => {
      setStatus(`Request failed: ${String(error)}`);
    })
    .finally(() => {
      scanButton.disabled = false;
    });
}

browser.runtime.onMessage.addListener((message) => {
  if (!message) {
    return;
  }
  if (message.target && message.target !== MESSAGE_TARGET_POPUP) {
    return;
  }
  handleEnrichmentMessage(message);
});

scanButton.addEventListener('click', () => {
  void scanCurrentPage();
});

optionsButton.addEventListener('click', () => {
  void browser.runtime.openOptionsPage();
});

refreshListsButton.addEventListener('click', () => {
  void loadListsForActiveSource({ showReadyMessage: true });
});

createListButton.addEventListener('click', () => {
  void createListForActiveSource();
});

listSelect.addEventListener('change', () => {
  void saveSelectedListSlug(listSelect.value || MAIN_LIST_SLUG);
});

void loadListsForActiveSource({ showReadyMessage: true });
