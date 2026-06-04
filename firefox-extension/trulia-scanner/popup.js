/* global browser */

const statusEl = document.getElementById('status');
const scanButton = document.getElementById('scanButton');
const optionsButton = document.getElementById('optionsButton');

function setStatus(message) {
  statusEl.textContent = message;
}

async function getSettings() {
  const values = await browser.storage.local.get([
    'ingestUrl',
    'ingestToken',
    'truliaIngestUrl',
    'truliaIngestToken',
    'forrentIngestUrl',
    'forrentIngestToken',
    'zillowIngestUrl',
    'zillowIngestToken'
  ]);
  return {
    truliaIngestUrl:
      typeof values.truliaIngestUrl === 'string'
        ? values.truliaIngestUrl.trim()
        : typeof values.ingestUrl === 'string'
          ? values.ingestUrl.trim()
          : '',
    truliaIngestToken:
      typeof values.truliaIngestToken === 'string'
        ? values.truliaIngestToken.trim()
        : typeof values.ingestToken === 'string'
          ? values.ingestToken.trim()
          : '',
    forrentIngestUrl: typeof values.forrentIngestUrl === 'string' ? values.forrentIngestUrl.trim() : '',
    forrentIngestToken: typeof values.forrentIngestToken === 'string' ? values.forrentIngestToken.trim() : '',
    zillowIngestUrl: typeof values.zillowIngestUrl === 'string' ? values.zillowIngestUrl.trim() : '',
    zillowIngestToken: typeof values.zillowIngestToken === 'string' ? values.zillowIngestToken.trim() : ''
  };
}

async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function scanCurrentPage() {
  const settings = await getSettings();
  const tab = await getActiveTab();
  if (!tab || !tab.id || !tab.url) {
    setStatus('Unable to determine active tab.');
    return;
  }

  let source = null;
  if (tab.url.includes('trulia.com')) {
    source = 'trulia';
  } else if (tab.url.includes('forrent.com')) {
    source = 'forrent';
  } else if (tab.url.includes('zillow.com')) {
    source = 'zillow';
  }

  if (!source) {
    setStatus('Active tab must be on Trulia, ForRent, or Zillow.');
    return;
  }

  const ingestUrl =
    source === 'trulia'
      ? settings.truliaIngestUrl
      : source === 'forrent'
        ? settings.forrentIngestUrl
        : settings.zillowIngestUrl;
  const ingestToken =
    source === 'trulia'
      ? settings.truliaIngestToken
      : source === 'forrent'
        ? settings.forrentIngestToken
        : settings.zillowIngestToken;
  if (!ingestUrl || !ingestToken) {
    setStatus(`Missing ${source} ingest URL/token. Open options and configure them first.`);
    return;
  }

  setStatus(`Scanning ${source} page...`);
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

  setStatus(`Found ${scanResult.listings.length} ${source} listings. Sending...`);
  try {
    const response = await fetch(ingestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ingestToken}`
      },
      body: JSON.stringify({ listings: scanResult.listings })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus(`Ingest failed (${response.status}): ${payload.error ?? 'Unknown error'}`);
      return;
    }

    setStatus(
      `Ingest complete.
Received: ${payload.received ?? '?'}
Accepted: ${payload.accepted ?? '?'}
Upserted: ${payload.upserted ?? '?'}
Rejected: ${payload.rejected ?? '?'}`
    );
  } catch (error) {
    setStatus(`Request failed: ${String(error)}`);
  }
}

scanButton.addEventListener('click', () => {
  void scanCurrentPage();
});

optionsButton.addEventListener('click', () => {
  void browser.runtime.openOptionsPage();
});
