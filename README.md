# Tempus Sales Copilot

**Everyone builds a generator. This builds a verifier.**

Drafting a pitch is one model call. Knowing whether the pitch is *true* before a
rep says it to a chief medical officer, at a company operating under FDA
labelling, is the part that has to be engineered. Every generated sentence
declares its evidence and passes four independent gates. Anything that fails is
withheld with a visible reason.

```bash
npm install
npm run dev      # http://localhost:5173
npm run verify   # typecheck + house style + golden set + gate 4 + adversarial fixtures
npm run style    # house style guard: no em dashes in source, docs or data
```

No API key is required. Without model credentials the app runs its deterministic
assembler and gate 4 reports **skipped** rather than silently passing; gates 1–3
always run.

### Enabling gate 4

Gate 4 needs **two** providers so the verifier is never the generator. Both have
free tiers:

1. [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → `GEMINI_API_KEY`
2. [console.groq.com/keys](https://console.groq.com/keys) → `GROQ_API_KEY`

```bash
cp .env.example .env.local     # then paste both keys
npm run dev
```

The chip in the header flips from `deterministic` to `gemini + groq`, and the
gate-4 badge on every claim changes from *skipped* to *pass* or *fail*. Keys are
read server-side only and never enter the client bundle.

`npm run gate4` proves the path end to end with stub providers, so the wiring is
verified whether or not keys are present.

### Deploying

Serverless functions in `api/` mirror the dev middleware, so the app runs on
Vercel's free tier with no code changes:

```bash
vercel deploy
```

Set `GEMINI_API_KEY`, `GROQ_API_KEY` and `VITE_MAPBOX_TOKEN` as project
environment variables. `api/npi.ts` proxies NPPES, which sends no CORS headers
and so cannot be called from a browser directly.

**The ranked list never depends on a third party being up.** NPPES is the
preferred provider source, but if it is unreachable the app falls back to the
ingested market-intelligence CSV, labels itself `Demo data: CSV only` in the
header, and still ranks, briefs and handles objections. Live enrichment (trials,
CMS utilization, Open Payments, geocoding) stays best-effort on top, and each
source degrades one signal rather than the whole territory. Demo rows carry no
NPPES `last_updated`, so record freshness and identity confidence score at their
floor: offline mode is visibly weaker than live mode rather than quietly
impersonating it.

## The four gates

| # | Gate | Runs | What it catches |
|---|---|---|---|
| 1 | Input screen | always | Prompt injection and PHI patterns in untrusted CRM text, screened before the prompt is built, so a poisoned note never reaches a model (`npm run adversarial` counts the outbound calls: 0 when blocked, 1 for the clean control) |
| 2 | Evidence grade | always | Grade-D inference. A claim inherits its weakest citation |
| 3 | Numeric guard | always | **Deterministic, no model call.** Every number must appear verbatim in cited evidence |
| 4 | Cross-model entailment | 2 providers | A *different* model, blind to the generation prompt, re-checks each claim |

Gate 3 matters most in practice: numbers are where hallucination does the most
damage and where detection is provable. Gate 4 is deliberately cross-model; a
model grading its own output is not a check.

The model never writes prose that reaches the user. It emits **structured claims**
that each name their evidence; final copy is assembled from the claims that
survived. You cannot check a paragraph, but you can check a sentence that cites
its sources.

**House style is enforced, not requested.** This product does not use em dashes.
Every system prompt carries the rule and every string a provider returns is run
through `stripEmDashes` in [`src/lib/style.ts`](src/lib/style.ts), because a
model complies with a style instruction only most of the time. Source text is
cleaned at ingest for the same reason, and `npm run style` fails the build if
one appears anywhere in source, docs or data.

## Entity resolution and cross-source consensus

A physician is not one record. They appear in six public sources under different
keys: three join on NPI, three only offer a name and an affiliation and so
require probabilistic linkage (Jaro-Winkler, 0.88 floor).

| Source | Join | Confidence |
|---|---|---|
| NPPES NPI Registry | NPI anchor | exact |
| CMS Medicare Utilization | NPI equality | exact |
| CMS Open Payments | `covered_recipient_npi` | exact |
| ClinicalTrials.gov | name + facility | 0.55 cap |
| PubMed | full name + affiliation | 0.60–0.75 |
| Wikidata | property P9450 | exact |

Sources then get cross-checked against each other. Where they disagree the field
is marked **contested**, identity confidence drops, and the rep is told to verify
rather than having the conflict resolved silently behind them. This is not
hypothetical: in live Chicago data, NPPES lists Dr. Manik Amin as "Internal
Medicine, Medical Oncology" while CMS Utilization and Open Payments both report
"Hematology-Oncology".

Identity confidence is a **ranking input** at 20%, so a provider we cannot
resolve across sources cannot out-rank one we can. The cross-validator is
load-bearing, not decorative.

## Ranking

`32% patient opportunity · 20% identity confidence · 17% panel fit · 13% CRM engagement · 10% record freshness · 8% market trial density`

Higher score means greater estimated eligible-patient impact and stronger
evidence confidence.

Patient opportunity prefers the vendor's modelled patient estimate, which is the
quantity the brief asks for; CMS utilization is the corroboration, and an
estimate with no Medicare record behind it is scored down for that reason.

Panel fit answers the question the brief actually asks: which physicians see
patients who benefit from Tempus's *specific* panels. It scores the **match
rate** (`indication fit × likelihood of testing`) rather than the volume:
patient count is already the opportunity term, and multiplying it in twice would
quietly turn the ranking into a headcount sort. Opportunity asks how big the
account is; panel fit asks how well it matches what we sell. The absolute figure,
`estimated patients × indication fit × likelihood of testing`, is carried
alongside and shown as "~480 patients/year fit this panel", because that is the
number a rep actually wants. Panel fit also names the panel: a colorectal-heavy practice routes to xT CDx
on the KRAS companion-diagnostic indication, a practice whose tissue is
frequently inadequate routes to xF, and a predominantly haematologic practice is
marked limited fit because xT CDx's labelled intended use is solid malignant
neoplasms. Market trial
density is city-level and identical for every provider in a market; it is
weighted low for that reason and labelled as such.

**Sensitivity analysis** shows where each provider would rank if a signal were
unavailable, so "why is this #3" has an answer rather than a bar chart.

## Account layer

The brief describes territories of "clinics and hospital systems" and meetings
with a **Chief Medical Officer**, who does not buy for themselves, but for a
site. Ranking individual physicians cannot represent the thing being bought, so
[`accounts.ts`](src/lib/accounts.ts) rolls physicians up.

Grouping is by the institution a source **named** for them, falling back to a
normalised NPPES practice address: suite and floor dropped, adjacent street
numbers treated as one campus. In live Chicago data that turns 11 physicians
into 5 accounts, correctly consolidating **6 Northwestern oncologists across two
buildings** into one conversation.

An objection raised independently by several physicians at one site is
surfaced as a shared theme, because a repeated concern is usually a pathway
constraint rather than a personal preference, which is exactly what a CMO can
act on.

## Why now

A reason to call is not a standing fact; it is a **dated event that decays**.
[`triggers.ts`](src/lib/triggers.ts) turns the pipeline's sources into ranked
triggers, each carrying its own date and source link:

| Trigger | Source | Specific to |
|---|---|---|
| They published recently | PubMed | this physician |
| Active competitor relationship | CMS Open Payments | this physician |
| Recruiting trials in their tumour focus | ClinicalTrials.gov | this physician |
| FDA action on xT CDx | FDA PMA P210011 | the market |

Physician-specific triggers outrank market-wide ones: *"your March 2026 paper"*
is a reason to call **them**; *"the FDA updated a label"* is true for everyone
and is context, not a trigger.

## Retrieval

Hybrid: Okapi BM25 over stemmed tokens, plus a curated topical channel mapping
rep vocabulary ("tissue requirements") onto document language ("FFPE",
"specimen"). Fused with reciprocal rank fusion: the channels are on
incomparable scales, so rank fusion avoids per-channel normalisation. BM25
carries the exact identifiers dense retrieval misses: gene counts, "MSI", "FFPE".

## Three ingested sources

The brief names three source formats. Each has its own parser, and nothing about
a physician is hard-coded in application source: edit a file, run
`npm run ingest`, and the copilot says something different.

| Source | Format | Path |
|---|---|---|
| Product knowledge base | Markdown | `kb/*.md` |
| CRM notes | Text | `data/crm/*.txt`, one file per physician |
| Market intelligence | CSV | `data/market-intelligence.csv` |

**Objections are extracted, not labelled.** A real Salesforce note does not
arrive with an enum attached, so each note is scored against an objection
vocabulary and the matched phrases are kept, so the extraction can be shown
rather than asserted:

```
extracted "turnaround time"  from 1265689889  via [how long, delay, took forever]
extracted "tissue requirements" from 1033548383 via [tissue, specimen, insufficient]
```

**The CSV is deliberately untrusted.** A rep is handed a third-party panel file;
it is usually stale and it is the input most likely to send someone to the wrong
building. So it enters as one more source to cross-check, not as ground truth,
and where it disagrees with NPPES the field is marked contested rather than
reconciled quietly. It supplies `est_annual_oncology_patients`, the only figure
answering the brief's "likely size of patient population", always labelled an
estimate and scored 30% lower when no CMS record corroborates it.

## Knowledge base

The corpus is **ingested, not hard-coded**. `npm run ingest` parses `/kb/*.md` into
retrievable chunks, one per `##` section, each declaring its own topics and a
speakable headline, inheriting source, URL, grade and access date from the
document frontmatter.

Performance figures are transcribed **verbatim from FDA PMA P210011 and its
Summary of Safety and Effectiveness Data**, not paraphrased:

- MSI vs IHC: PPA 94.0% (95% CI: 88-98%), NPA 98% (95% CI: 95-99%)
- KRAS in colorectal cancer: PPA 100%, NPA 99.83%
- Companion diagnostic variants overall: PPA 100%, NPA 99.8%

The build fails if a headline states a number absent from its source text, so a
short form can never drift from what the document said.

**Turnaround time is answered from the 10-K, not from marketing copy.** It
appears nowhere in PMA P210011, its SSED, or the xT CDx Technical Information
sheet, but Tempus states it in its FY2025 Form 10-K, filed with the SEC on
2026-02-24: xT averaged approximately nine days and xF approximately eight days
as of 2025-12-31, against an approximately 10-day quoted turnaround for xT CDx.
The same filing states that laboratory workflows deliver results over 98% of the
time when tissue meets the stated minimum requirements. An SEC filing is dated,
attributable and quotable, which is the whole bar, so the objection handler
answers the brief's worked example with a real metric instead of refusing it.

**Pricing is still deliberately absent.** No approved source states it, so cost,
coverage and reimbursement remain declared gaps: the objection handler refuses,
pivots to the strongest supported evidence, and hands the rep a discovery
question. The refusal path is unchanged; it was never weakened to satisfy the
worked example; a source was found instead.

## Data contract

**Real**: NPPES, CMS Medicare Utilization (2024), CMS Open Payments (2024),
ClinicalTrials.gov v2, PubMed E-utilities, Wikidata, FDA PMA P210011 and its
SSED, Tempus technical documentation, Tempus AI Form 10-K (FY2025, SEC).

**Simulated**: 12 CRM notes keyed to real NPIs across four markets, written the
way Salesforce notes actually look. Two are deliberately adversarial and are
blocked by gate 1. Every simulated element is labelled in the UI.

Model credentials are held server-side and never reach the bundle.

## Documentation

- [Validation](docs/VALIDATION.md): executable results, and the bugs this found in live data
- [Roadmap](docs/ROADMAP.md): Phase 1 as built, Phase 2 as designed

Decision support only. Not for clinical use. Generated language is reviewed by a
person before it is said aloud.
