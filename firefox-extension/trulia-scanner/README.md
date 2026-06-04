# House4Me Trulia Scanner (Firefox)

This extension scans the current Trulia page and sends listing data to:

`/.netlify/functions/ingest-trulia-listings`

## Load Extension Locally

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `manifest.json` from this folder.

## Configure

1. Open extension options.
2. Set:
   - **Ingest URL**: e.g. `http://localhost:9999/.netlify/functions/ingest-trulia-listings`
   - **Ingest Token**: value matching Netlify env var `TRULIA_INGEST_TOKEN`

## Use

1. Navigate to a Trulia search results page.
2. Open the extension popup.
3. Click **Scan current page**.
