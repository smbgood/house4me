/* global browser */

const statusEl = document.getElementById('status');
const scanButton = document.getElementById('scanButton');
const optionsButton = document.getElementById('optionsButton');

function setStatus(message) {
  statusEl.textContent = message;
}

async function getSettings() {
  const values = await browser.storage.local.get(['ingestUrl', 'ingestToken']);
  return {
    ingestUrl: typeof values.ingestUrl === 'string' ? values.ingestUrl.trim() : '',
    ingestToken: typeof values.ingestToken === 'string' ? values.ingestToken.trim() : ''
  };
}

async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function scanCurrentPage() {
  const settings = await getSettings();
  if (!settings.ingestUrl || !settings.ingestToken) {
    setStatus('Missing ingest URL/token. Open options and configure them first.');
    return;
  }

  const tab = await getActiveTab();
  if (!tab || !tab.id || !tab.url) {
    setStatus('Unable to determine active tab.');
    return;
  }

  if (!tab.url.includes('trulia.com')) {
    setStatus('Active tab is not a Trulia page.');
    return;
  }

  setStatus('Scanning page...');
  let scanResult;
  try {
    scanResult = await browser.tabs.sendMessage(tab.id, { type: 'SCAN_TRULIA_PAGE' });
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

  setStatus(`Found ${scanResult.listings.length} listings. Sending...`);
  try {
    const response = await fetch(settings.ingestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.ingestToken}`
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
