# House4Me Rental Scanner (Firefox)

This extension scans the current Trulia, ForRent, Zillow, or Realtor.com page and sends listing data to [House4Me](https://house4me.netlify.app/):

- `https://house4me.netlify.app/.netlify/functions/ingest-trulia-listings`
- `https://house4me.netlify.app/.netlify/functions/ingest-forrent-listings`
- `https://house4me.netlify.app/.netlify/functions/ingest-zillow-listings`
- `https://house4me.netlify.app/.netlify/functions/ingest-realtor-listings`

## Load Extension Locally

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `manifest.json` from this folder.

## Configure

1. Open extension options.
2. Set each source-specific ingest token:
   - **Trulia Ingest Token**: value matching Netlify env var `TRULIA_INGEST_TOKEN`
   - **ForRent Ingest Token**: value matching Netlify env var `FORRENT_INGEST_TOKEN`
   - **Zillow Ingest Token**: value matching Netlify env var `ZILLOW_INGEST_TOKEN`
   - **Realtor.com Ingest Token**: value matching Netlify env var `REALTOR_INGEST_TOKEN`

## Use

1. Navigate to a Trulia, ForRent, Zillow, or Realtor.com search results page.
2. Open the extension popup.
3. Click **Scan current page**.
