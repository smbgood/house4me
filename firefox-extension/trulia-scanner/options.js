/* global browser, House4MeConfig */

const form = document.getElementById('settingsForm');
const ingestBaseUrlEl = document.getElementById('ingestBaseUrl');
const truliaIngestTokenInput = document.getElementById('truliaIngestToken');
const forrentIngestTokenInput = document.getElementById('forrentIngestToken');
const zillowIngestTokenInput = document.getElementById('zillowIngestToken');
const realtorIngestTokenInput = document.getElementById('realtorIngestToken');
const statusEl = document.getElementById('status');

ingestBaseUrlEl.textContent = House4MeConfig.INGEST_BASE_URL;

function setStatus(message) {
  statusEl.textContent = message;
}

async function loadSettings() {
  const values = await browser.storage.local.get([
    'ingestToken',
    'truliaIngestToken',
    'forrentIngestToken',
    'zillowIngestToken',
    'realtorIngestToken'
  ]);
  truliaIngestTokenInput.value =
    typeof values.truliaIngestToken === 'string'
      ? values.truliaIngestToken
      : typeof values.ingestToken === 'string'
        ? values.ingestToken
        : '';
  forrentIngestTokenInput.value = typeof values.forrentIngestToken === 'string' ? values.forrentIngestToken : '';
  zillowIngestTokenInput.value = typeof values.zillowIngestToken === 'string' ? values.zillowIngestToken : '';
  realtorIngestTokenInput.value = typeof values.realtorIngestToken === 'string' ? values.realtorIngestToken : '';
}

form.addEventListener('submit', (event) => {
  event.preventDefault();

  const truliaIngestToken = truliaIngestTokenInput.value.trim();
  const forrentIngestToken = forrentIngestTokenInput.value.trim();
  const zillowIngestToken = zillowIngestTokenInput.value.trim();
  const realtorIngestToken = realtorIngestTokenInput.value.trim();
  if (!truliaIngestToken || !forrentIngestToken || !zillowIngestToken || !realtorIngestToken) {
    setStatus('All fields are required.');
    return;
  }

  void browser.storage.local
    .set({
      truliaIngestToken,
      forrentIngestToken,
      zillowIngestToken,
      realtorIngestToken,
      ingestToken: truliaIngestToken
    })
    .then(() => setStatus('Settings saved.'))
    .catch((error) => setStatus(`Failed to save: ${String(error)}`));
});

void loadSettings();
