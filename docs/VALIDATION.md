# Phase 1 validation matrix

| Scenario | Expected behavior | Result |
|---|---|---|
| Provider outside searched city | Excluded using exact active NPI practice-location match | Pass |
| CMS record exists | Show 2024 Original Medicare beneficiaries/services and source | Pass |
| CMS record missing | Show unavailable; opportunity becomes 0; never impute volume | Pass |
| Simulated CRM exists | Show visible `SIMULATED` label and engagement contribution | Pass |
| CRM missing | Show empty state and award 0 engagement points | Pass |
| Supported product concern | Retrieve official Tempus evidence with URL and access date | Pass |
| Unsupported turnaround/cost metric | Return “insufficient evidence” instead of generating a number | Pass |
| Ambiguous publication author | Require full name plus city affiliation; otherwise show no match | Pass |
| Physician photo mismatch | Require NPI-linked Wikidata or audited official source | Pass |
| Trial in same city | Label as market activity, not physician participation | Pass |

## Known limitations

- CMS utilization is annual, limited to Original Medicare fee-for-service, and suppresses values representing fewer than 11 beneficiaries.
- City-level trial activity does not establish that a provider is an investigator or treats trial participants.
- NPPES is provider-reported directory data and does not independently validate licensure.
- CRM records in this prototype are simulated because real Tempus Salesforce data is unavailable.
- The deterministic rank is an explainable baseline, not a prediction of conversion, clinical quality, or treatment suitability.

## Acceptance metrics for a real pilot

- Citation correctness: 100% for numerical and product claims.
- Unsupported numerical claim rate: 0%.
- NPI/location match precision: 100% on the reviewed demo set.
- Median meeting-preparation time: target under 3 minutes.
- Rep usefulness score: target at least 4/5.
