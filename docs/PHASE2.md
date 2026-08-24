# Phase 2 model and governance

## Architecture

The Phase 1 deterministic score remains the operational ranking. Phase 2 adds a shadow logistic-regression model trained on five normalized features:

1. CMS opportunity
2. Local trial activity
3. CRM engagement
4. NPI freshness
5. Evidence confidence

The bootstrap dataset contains 12 explicitly simulated outcomes. Genuine `Meeting booked` and `Not relevant` feedback is stored separately in browser storage and added to subsequent training runs.

## Why shadow mode

The prototype has no real Tempus conversion history. Allowing a model trained mostly on simulated labels to change ranking would create false precision. Shadow mode demonstrates the learning architecture while preserving the defensible Phase 1 baseline.

Promotion requires:

- At least 40 genuine labeled outcomes
- Provider-level train/test separation
- Held-out precision@5 and NDCG evaluation
- Brier score and calibration-curve review
- Performance slices by specialty, geography, and data completeness
- Sales-operations approval of labels and intervention policy

## Slack decision rule

An alert is eligible only when all conditions hold:

- Provider rank is 5 or better
- Evidence score is at least 70
- Score increased by at least 10 since the previous complete evidence refresh
- Evidence confidence is at least 70
- At least one recruiting cancer trial exists in the market

The alert contains name, NPI, rank, score, recommended action, and a public NPI link. It excludes CRM notes, patient information, and protected health information.

## Operational limitations

- Local storage is a prototype substitute for authenticated outcome storage.
- A production system needs Salesforce identity, event schemas, access controls, audit logging, retention rules, and a backend feature store.
- Incoming Slack webhooks cannot delete posted messages. Rotate the webhook immediately if it is ever exposed.
- Bootstrap accuracy is diagnostic only and must not be reported as expected production performance.
