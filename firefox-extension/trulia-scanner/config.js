/* global window */

const INGEST_BASE_URL = 'https://house4me.netlify.app/';

const INGEST_PATHS = {
  trulia: '.netlify/functions/ingest-trulia-listings',
  forrent: '.netlify/functions/ingest-forrent-listings',
  zillow: '.netlify/functions/ingest-zillow-listings',
  realtor: '.netlify/functions/ingest-realtor-listings'
};

function getIngestUrl(source) {
  const path = INGEST_PATHS[source];
  if (!path) {
    return '';
  }
  return new URL(path, INGEST_BASE_URL).href;
}

window.House4MeConfig = {
  INGEST_BASE_URL,
  INGEST_PATHS,
  getIngestUrl
};
