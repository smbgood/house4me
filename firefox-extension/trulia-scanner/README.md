# House4Me Rental Scanner (Firefox)

This extension scans the current Trulia, ForRent, Zillow, or Realtor.com page and sends listing data to:

- `/.netlify/functions/ingest-trulia-listings`
- `/.netlify/functions/ingest-forrent-listings`
- `/.netlify/functions/ingest-zillow-listings`
- `/.netlify/functions/ingest-realtor-listings`

## Load Extension Locally

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `manifest.json` from this folder.

## Configure

1. Open extension options.
2. Set all source-specific settings:
   - **Trulia Ingest URL**: e.g. `http://localhost:9999/.netlify/functions/ingest-trulia-listings`
   - **Trulia Ingest Token**: value matching Netlify env var `TRULIA_INGEST_TOKEN`
   - **ForRent Ingest URL**: e.g. `http://localhost:9999/.netlify/functions/ingest-forrent-listings`
   - **ForRent Ingest Token**: value matching Netlify env var `FORRENT_INGEST_TOKEN`
   - **Zillow Ingest URL**: e.g. `http://localhost:9999/.netlify/functions/ingest-zillow-listings`
   - **Zillow Ingest Token**: value matching Netlify env var `ZILLOW_INGEST_TOKEN`
   - **Realtor.com Ingest URL**: e.g. `http://localhost:9999/.netlify/functions/ingest-realtor-listings`
   - **Realtor.com Ingest Token**: value matching Netlify env var `REALTOR_INGEST_TOKEN`

## Use

1. Navigate to a Trulia, ForRent, Zillow, or Realtor.com search results page.
2. Open the extension popup.
3. Click **Scan current page**.
