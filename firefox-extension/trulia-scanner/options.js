/* global browser */

const form = document.getElementById('settingsForm');
const ingestUrlInput = document.getElementById('ingestUrl');
const ingestTokenInput = document.getElementById('ingestToken');
const statusEl = document.getElementById('status');

function setStatus(message) {
  statusEl.textContent = message;
}

async function loadSettings() {
  const values = await browser.storage.local.get(['ingestUrl', 'ingestToken']);
  ingestUrlInput.value = typeof values.ingestUrl === 'string' ? values.ingestUrl : '';
  ingestTokenInput.value = typeof values.ingestToken === 'string' ? values.ingestToken : '';
}

form.addEventListener('submit', (event) => {
  event.preventDefault();

  const ingestUrl = ingestUrlInput.value.trim();
  const ingestToken = ingestTokenInput.value.trim();
  if (!ingestUrl || !ingestToken) {
    setStatus('Both fields are required.');
    return;
  }

  void browser.storage.local
    .set({ ingestUrl, ingestToken })
    .then(() => setStatus('Settings saved.'))
    .catch((error) => setStatus(`Failed to save: ${String(error)}`));
});

void loadSettings();
