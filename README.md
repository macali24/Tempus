# Tempus Sales Copilot prototype

A source-grounded oncology territory dashboard. Tempus searches real public provider records, combines them with active local clinical-trial signals, explains its ranking, and creates a reviewable meeting opener grounded in official Tempus product information.

## Run locally

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and set `VITE_MAPBOX_TOKEN` before starting. The local workspace is already configured; `.env.local` is ignored by Git.

Open the URL printed by Vite. Search a supported US city and state. Vite proxies the NPPES request because that federal endpoint does not permit cross-origin browser calls; no response data is altered or stored. The app retrieves current records from:

- CMS NPPES NPI Registry API — provider identity, specialty, practice location, and record recency
- ClinicalTrials.gov API v2 — recruiting local cancer studies
- Mapbox Geocoding API + Mapbox GL — real provider-address coordinates and interactive territory map
- Wikidata SPARQL API — optional doctor photos, shown only when Wikidata property P9450 exactly matches the CMS NPI
- Tempus official xT CDx product page — product capability used in the meeting brief

No source records are mocked or stored in the repository. If either live API fails, the app shows an error rather than substituting fabricated data.

## Ranking

`Priority = 45% oncology specialty fit + 40% local recruiting-trial signal + 15% NPI record recency`

This prototype intentionally does not claim patient volume, prescribing behavior, CRM sentiment, or institutional affiliation because those fields are not supported by the public APIs.

Map tools include provider fly-to and evidence popups, reset-to-territory, user geolocation, fullscreen mode, zoom, pitch, and rotation. These use Mapbox GL's free client controls and require no additional paid tooling.

## Important limitation

This is a take-home prototype for sales decision support, not clinical use. Generated meeting language must be reviewed by a person before use.
