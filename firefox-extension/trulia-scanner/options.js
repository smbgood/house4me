/* global browser */

const form = document.getElementById('settingsForm');
const truliaIngestUrlInput = document.getElementById('truliaIngestUrl');
const truliaIngestTokenInput = document.getElementById('truliaIngestToken');
const forrentIngestUrlInput = document.getElementById('forrentIngestUrl');
const forrentIngestTokenInput = document.getElementById('forrentIngestToken');
const statusEl = document.getElementById('status');

function setStatus(message) {
  statusEl.textContent = message;
}

async function loadSettings() {
  const values = await browser.storage.local.get([
    'ingestUrl',
    'ingestToken',
    'truliaIngestUrl',
    'truliaIngestToken',
    'forrentIngestUrl',
    'forrentIngestToken'
  ]);
  truliaIngestUrlInput.value =
    typeof values.truliaIngestUrl === 'string'
      ? values.truliaIngestUrl
      : typeof values.ingestUrl === 'string'
        ? values.ingestUrl
        : '';
  truliaIngestTokenInput.value =
    typeof values.truliaIngestToken === 'string'
      ? values.truliaIngestToken
      : typeof values.ingestToken === 'string'
        ? values.ingestToken
        : '';
  forrentIngestUrlInput.value = typeof values.forrentIngestUrl === 'string' ? values.forrentIngestUrl : '';
  forrentIngestTokenInput.value = typeof values.forrentIngestToken === 'string' ? values.forrentIngestToken : '';
}

form.addEventListener('submit', (event) => {
  event.preventDefault();

  const truliaIngestUrl = truliaIngestUrlInput.value.trim();
  const truliaIngestToken = truliaIngestTokenInput.value.trim();
  const forrentIngestUrl = forrentIngestUrlInput.value.trim();
  const forrentIngestToken = forrentIngestTokenInput.value.trim();
  if (!truliaIngestUrl || !truliaIngestToken || !forrentIngestUrl || !forrentIngestToken) {
    setStatus('All fields are required.');
    return;
  }

  void browser.storage.local
    .set({
      truliaIngestUrl,
      truliaIngestToken,
      forrentIngestUrl,
      forrentIngestToken,
      ingestUrl: truliaIngestUrl,
      ingestToken: truliaIngestToken
    })
    .then(() => setStatus('Settings saved.'))
    .catch((error) => setStatus(`Failed to save: ${String(error)}`));
});

void loadSettings();
