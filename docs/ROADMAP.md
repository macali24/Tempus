# Tempus Sales Copilot: Two-Phase Build Plan

> **Phase 1 is built.** See the README for what shipped and
> [VALIDATION.md](VALIDATION.md) for executable results. Phase 2 below is design,
> not code. Open Payments moved forward into Phase 1 because entity resolution
> needed it as a source; the displacement *strategy* layer stays in Phase 2.

**Thesis:** Everyone builds a generator. We build a verifier.
Drafting a pitch is one LLM call. Knowing whether the pitch is *true*, before a rep
says it to a CMO, under FDA labeling constraints, is the defensible problem.

---

## PHASE 1: The Verified Truth Engine ("provably right")

### 1.1 Entity Resolution Graph
Canonical `PhysicianEntity` resolved across six live sources:

| Source | Join method | Confidence |
|---|---|---|
| NPPES | NPI anchor | exact |
| CMS Medicare Utilization | NPI equality | exact |
| CMS Open Payments | `covered_recipient_npi` equality | exact |
| ClinicalTrials.gov investigators | name + facility | probabilistic |
| PubMed | full author name + affiliation | probabilistic |
| Wikidata | P9450 == NPI | exact |

Every linkage stores `matchMethod` and `matchConfidence`. Record linkage is the
substrate; no other candidate will build it.

### 1.2 Cross-Source Contradiction Detector  ← the cross-validator
Multiple sources assert overlapping facts (practice city, institution, specialty,
active status). Detect disagreement and emit a **Consensus Report**:

- **Agreed**: n sources concur → high confidence
- **Contested**: sources disagree → flagged, confidence reduced
- **Single-source**: marked unverified

Rep-facing framing: *"3 of 4 sources place Dr. X at Northwestern; a 2024 PubMed
affiliation says Mayo, verify before calling."* This targets the rep's real fear:
walking in with stale information.

### 1.3 Real KB ingestion + hybrid retrieval
- Ingest actual Tempus docs (xT CDx, xF, xM, xR, technical info) to `/kb` as markdown,
  chunked with `source`, `section`, `accessedAt`.
- **Hybrid retrieval**: BM25 lexical + embeddings (`Xenova/all-MiniLM-L6-v2` via
  transformers.js, in-browser, free, no API key) fused with reciprocal rank fusion.
- Rationale: embeddings miss exact gene counts and product codes; BM25 catches them.

### 1.4 Grounded generation with claim-level provenance
The model emits **structured JSON, not prose**:
```
{ claims: [ { text, evidenceIds[], grade } ], assembledFrom: [...] }
```
Prose is assembled from validated claims. Forcing the model to declare which evidence
supports each sentence is what makes validation tractable.

### 1.5 The Cross-Validator: four independent gates
1. **Numeric guard (deterministic, zero model calls).** Regex-extract every number,
   date, percentage, gene count; assert verbatim presence in cited chunks. Catches the
   highest-damage hallucinations, provably.
2. **Entailment check (cross-model).** A *different* provider (Groq/Llama) sees only
   `(claim, evidence)`, never the generation prompt, and returns
   supported / partial / unsupported. Cross-model, not self-grading.
3. **Evidence grade.** A = FDA label/regulatory · B = peer-reviewed · C = company
   technical doc · D = inference → **blocked**. Grades render beside each claim; this
   is the hierarchy oncologists already use.
4. **Injection & PII screen.** CRM notes are untrusted text flowing into a prompt.
   Screen for injection patterns, strip PHI, before the model sees them.

Failed claims are **not silently dropped**; they render as *"withheld: unsupported"*
with the reason. That is the demo money-shot.

### 1.6 Golden eval suite (executable, in CI)
~40 cases: supported claims, unsupported claims, poisoned evidence, injection attempts
embedded in CRM notes, numeric-drift cases. Reports precision/recall **of the validator
itself**. Converts VALIDATION.md from assertion into evidence.
Slide metric: *"validator caught 38/40 planted hallucinations."*

### 1.7 Deployability
- Serverless functions replace the dev-only NPPES proxy → real public URL, zero setup.
- LLM provider abstraction with failover: Gemini → Groq → in-browser WebLLM.
  Reviewer needs no API key.
- **Snapshot mode**: frozen territory fixture so the demo/video never depends on
  network. Toggle live/snapshot in the UI.

### 1.8 Debt paid down
`exactFit` dead code (computed, never scored, never rendered); CRM coverage beyond
Chicago; App.tsx readability.

---

## PHASE 2: The Adaptive Intelligence Engine ("uniquely smart")

### 2.1 Trigger Engine: "Why Now" as dated events
| Trigger | Source | Verified |
|---|---|---|
| New approval in tumor type | openFDA drugsfda | yes, 5,637 recent submissions |
| Trial newly recruiting <90d | CTG `lastUpdatePostDateStruct` | yes |
| Publication <12mo | PubMed | yes |
| Recent competitor/pharma payment | Open Payments | yes |

Each trigger is `{ event, date, sourceUrl, decay }`; score decays with age.
"Why Now" becomes a dated event, not an adjective.

### 2.2 Competitor Displacement Intelligence  ← strongest single idea
Open Payments joined by NPI segments the territory:
- **Competitor-engaged** (already paid by Foundation Medicine / Guardant / Natera) →
  they already believe in CGP. Displacement play; lead on differentiation.
- **Unengaged** → education play; lead on clinical utility.

This changes the *strategy* of the pitch, not just its wording.
**Engineering note:** `like` queries on this dataset time out. Query by NPI equality
(fast, indexed), filter manufacturer names client-side.

### 2.3 Panel-fit inference
Tumor profile from taxonomy + trial conditions + PubMed MeSH → map to xT / xF / xM / xR.
Answers the case study's literal ask: *which doctors see patients that benefit from
Tempus's specific panels.*

### 2.4 Bounded multi-agent research loop
A planner decides which enrichments are worth fetching for *this* provider (skip PubMed
when there's no research signal), executes tool calls, halts on confidence threshold or
budget. Agentic design with explicit cost control, not an unbounded ReAct toy.

### 2.5 Ranking science, not just weights
- **Sensitivity analysis** per provider: *"without CMS data you'd rank #7, not #3."*
- **Rank stability under noise**: perturb inputs ±10% × 500 runs, report top-5 churn.
  A ranking that flips under noise isn't a ranking.
- **Live weight tuning** in-UI with instant re-rank; sales ops retunes without an engineer.

### 2.6 Objection intelligence from messy notes
Rewrite CRM fixtures as realistic multi-touch, contradictory, typo-laden Salesforce prose
for 10 physicians across ≥3 markets. The LLM **extracts** objections instead of reading a
pre-labeled field. That is where GenAI earns its place.

### 2.7 Closed-loop learning
Keep shadow mode; add: rep edits the generated pitch → diff captured as preference signal
→ surface which claim types get cut most. An honestly-scoped RLHF-shaped loop.

---

## If time runs short: the minimum winning core
1.1 · 1.2 · 1.5 · 1.6 · 1.7 · 2.1 · 2.2
Entity resolution, contradiction detection, the validator gates, the executable eval,
a live URL, dated triggers, competitor displacement.
