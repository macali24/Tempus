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
- Audited official-profile registry — a small NPI-keyed fallback for headshots verified against hospital or university profiles
- Tempus official xT CDx product page — product capability used in the meeting brief

No source records are mocked or stored in the repository. If either live API fails, the app shows an error rather than substituting fabricated data.

## Ranking

`Priority = 40% CMS opportunity + 15% local trial activity + 15% simulated CRM engagement + 15% NPI freshness + 15% evidence confidence`

CMS opportunity is normalized within the current market using the logarithm of 2024 Original Medicare beneficiary counts. It is an opportunity proxy, not total patient volume. Missing CMS or CRM data lowers the score rather than being imputed.

This prototype intentionally does not claim patient volume, prescribing behavior, CRM sentiment, or institutional affiliation because those fields are not supported by the public APIs.

## Phase 1 evidence workflow

- Eight simulated CRM records are keyed to real Chicago NPIs and visibly labeled `SIMULATED`.
- Objection responses retrieve from a small curated knowledge base of official Tempus xT CDx claims.
- Unsupported concerns return “insufficient evidence”; no metric is invented.
- Meeting scripts combine displayed CMS, trial, CRM, and Tempus evidence and require human review.
- PubMed results require a full-author-name and city-affiliation match.
- The in-app **Evidence & assumptions** model card documents weights, safeguards, and limitations.

See [Phase 1 validation](docs/VALIDATION.md) for the test matrix.

Map tools include provider fly-to and evidence popups, reset-to-territory, user geolocation, fullscreen mode, zoom, pitch, and rotation. These use Mapbox GL's free client controls and require no additional paid tooling.

## Important limitation

This is a take-home prototype for sales decision support, not clinical use. Generated meeting language must be reviewed by a person before use.
