# Residential Growth Automation

Monthly Residential Growth imports mirror the existing STREETS auto-ingest pattern:

`Outlook email → Power Automate → Cloud Function → Firebase → Planning Data workspace / PDF link`

## Cloud Function

Deploy `ingestResidentialGrowthReport` with the same `INGEST_API_KEY` secret used by STREETS and a `MAPBOX_TOKEN` secret for geocoding/static-map PDF generation.

Endpoint query parameters:

- `teamId`: Scheduler team ID
- `period`: month in `YYYY-MM` format
- `reportType`: `issued` or `occupied`

Accepted request body:

- raw `.xlsx` attachment bytes, or
- JSON with `fileBase64` or `contentBytes`, plus optional `fileName`

## Power Automate flow

Create two branches or two flows:

1. Issuance Listing email/attachment → POST to:
   `ingestResidentialGrowthReport?teamId=...&period=YYYY-MM&reportType=issued`
2. Certificate of Occupancy email/attachment → POST to:
   `ingestResidentialGrowthReport?teamId=...&period=YYYY-MM&reportType=occupied`

Headers:

- `x-api-key`: same value stored in `INGEST_API_KEY`
- `Content-Type`: `application/octet-stream` for raw attachment bytes, or `application/json` for base64 wrapper

## Behaviour

- First file received for a month is stored as pending.
- When the matching monthly file arrives, the function parses both, geocodes addresses, saves the combined dataset, generates a PDF, and returns `pdfDownloadUrl`.
- Power Automate should send the management email and attach/link the returned PDF.
- The workspace can load saved monthly imports together and filter/sum records by uploaded month: latest uploaded month, one selected month, latest 3 months, or latest 12 months. Repeated uploads of the same stable record are deduplicated before totals are shown.
