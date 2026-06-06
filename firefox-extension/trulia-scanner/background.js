/* global browser */

const MESSAGE_TARGET_BACKGROUND = 'house4me-background';
const MESSAGE_TARGET_POPUP = 'house4me-popup';
const GET_ENRICHMENT_EVENT_MESSAGE_TYPE = 'HOUSE4ME_GET_ENRICHMENT_EVENT';

const ENRICHMENT_EVENT_TYPES = new Set([
  'FORRENT_ENRICH_STARTED',
  'FORRENT_ENRICH_PROGRESS',
  'FORRENT_ENRICH_COMPLETE',
  'FORRENT_ENRICH_ERROR',
  'TRULIA_ENRICH_STARTED',
  'TRULIA_ENRICH_PROGRESS',
  'TRULIA_ENRICH_COMPLETE',
  'TRULIA_ENRICH_ERROR'
]);

const latestEventByJobId = new Map();
let latestEvent = null;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isEnrichmentEvent(message) {
  return isObject(message) && typeof message.type === 'string' && ENRICHMENT_EVENT_TYPES.has(message.type);
}

function rememberEvent(message, sender) {
  const storedEvent = {
    ...message,
    target: MESSAGE_TARGET_POPUP,
    sourceTabId: Number.isFinite(sender?.tab?.id) ? sender.tab.id : null
  };

  latestEvent = storedEvent;
  if (typeof storedEvent.jobId === 'string' && storedEvent.jobId.trim().length > 0) {
    latestEventByJobId.set(storedEvent.jobId.trim(), storedEvent);
  }
  return storedEvent;
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (!isObject(message)) {
    return undefined;
  }

  if (message.type === GET_ENRICHMENT_EVENT_MESSAGE_TYPE && message.target === MESSAGE_TARGET_BACKGROUND) {
    const requestedJobId = typeof message.jobId === 'string' ? message.jobId.trim() : '';
    const event = requestedJobId ? latestEventByJobId.get(requestedJobId) ?? null : latestEvent;
    return Promise.resolve({
      ok: true,
      event
    });
  }

  if (message.target !== MESSAGE_TARGET_BACKGROUND || !isEnrichmentEvent(message)) {
    return undefined;
  }

  const eventForPopup = rememberEvent(message, sender);
  void browser.runtime.sendMessage(eventForPopup).catch(() => {
    // Popup may not be open; ignore relay failures.
  });

  return undefined;
});
