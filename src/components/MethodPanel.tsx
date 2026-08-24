import { Check, X } from 'lucide-react';
import { KB, KNOWN_GAPS, gradeLabel } from '../lib/kb';
import { Card } from './Card';
import type { ProviderId } from '../lib/llm';

export function MethodPanel({
  weights,
  labels,
  models,
}: {
  weights: Record<string, number>;
  labels: Record<string, string>;
  models: ProviderId[];
}) {
  const external = models.filter(m => m !== 'deterministic');

  return (
    <div className="reading">
      <div className="notice info">
        <Check />
        <span>
          <b>Drafting a pitch is one model call.</b> Knowing whether it is true before a rep says it to a
          chief medical officer is the engineered part. Every claim declares its evidence and passes four
          independent gates; anything that fails is withheld with a visible reason.
        </span>
      </div>

      <Card title="Validation gates" lede="4 gates · 3 always on" open>
        <Gate n={1} name="Input screen" desc="Prompt-injection and PHI patterns in untrusted CRM text" on />
        <Gate
          n={2}
          name="Evidence grade"
          desc="Grade D inference is never citable; a claim inherits its weakest source"
          on
        />
        <Gate
          n={3}
          name="Numeric guard"
          desc="Deterministic, no model call. Every number must appear verbatim in cited evidence"
          on
        />
        <Gate
          n={4}
          name="Cross-model entailment"
          desc="A different model, blind to the generation prompt, re-checks each claim"
          on={external.length > 1}
          note={external.length > 1 ? 'ACTIVE' : 'NEEDS 2 KEYS'}
        />
        {external.length < 2 && (
          <p className="hint" style={{ marginTop: 12 }}>
            Gate 4 needs two configured providers so the verifier is never the generator. With fewer it
            reports <b>skipped</b> rather than silently passing.
          </p>
        )}
      </Card>

      <Card title="Ranking weights" lede="explainable, deterministic">
        {Object.entries(weights).map(([key, weight]) => (
          <div className="wbar" key={key}>
            <span className="lbl">{labels[key]}</span>
            <span className="track">
              <i style={{ width: `${weight * 300}%` }} />
            </span>
            <span className="num">{Math.round(weight * 100)}%</span>
          </div>
        ))}
        <p className="hint" style={{ marginTop: 12 }}>
          Identity confidence is an input, so a provider we cannot resolve across sources cannot out-rank one
          we can. Missing data lowers a score; it is never imputed. Market trial density is a market-level
          signal and is identical for every provider in the same city; it is weighted low for that reason.
        </p>
      </Card>

      <Card title="Evidence grades" lede="A–D, weakest citation wins">
        {(['A', 'B', 'C', 'D'] as const).map(grade => (
          <div className="evi" key={grade}>
            <span className={`grade ${grade}`}>{grade}</span>
            <span className="txt">{gradeLabel[grade]}</span>
          </div>
        ))}
      </Card>

      <Card title="Three ingested sources" lede="Markdown · Text · CSV" open>
        <div className="row-line">
          <Check style={{ color: 'var(--green)' }} />
          <span className="label">Product knowledge base: <span className="mono">kb/*.md</span>
            <small>Markdown with frontmatter, one chunk per section. Performance figures transcribed verbatim from FDA PMA P210011 and its SSED.</small>
          </span>
          <span className="tag exact">MARKDOWN</span>
        </div>
        <div className="row-line">
          <Check style={{ color: 'var(--green)' }} />
          <span className="label">CRM notes: <span className="mono">data/crm/*.txt</span>
            <small>One plain-text file per physician. The objection is extracted from the prose, not read from a labelled field.</small>
          </span>
          <span className="tag exact">TEXT</span>
        </div>
        <div className="row-line">
          <Check style={{ color: 'var(--green)' }} />
          <span className="label">Market intelligence: <span className="mono">data/market-intelligence.csv</span>
            <small>Vendor panel file supplying the patient-population estimate. Treated as untrusted and cross-checked against NPPES and CMS.</small>
          </span>
          <span className="tag exact">CSV</span>
        </div>
        <p className="hint" style={{ marginTop: 12 }}>
          Nothing about a physician is hard-coded in application source. Edit a file, run
          <span className="mono"> npm run ingest</span>, and the copilot says something different.
        </p>
      </Card>

      <Card title="Data contract" lede="live + on-demand · 12 simulated notes">
        <div className="row-line">
          <Check style={{ color: 'var(--green)' }} />
          <span className="label">
            Real
            <small>
              NPPES · CMS Medicare utilization · CMS Open Payments · ClinicalTrials.gov · PubMed on demand ·
              official Tempus documentation. Wikidata is planned but not queried in this build.
            </small>
          </span>
        </div>
        <div className="row-line">
          <span className="chip sim" style={{ height: 18 }}>
            SIM
          </span>
          <span className="label">
            Simulated
            <small>
              12 CRM notes keyed to real NPIs across four markets. Two are deliberately adversarial and are
              blocked by gate 1.
            </small>
          </span>
        </div>
      </Card>

      <Card
        title="Documented gaps"
        lede="fails closed"
        aside={<span className="chip warn">{KNOWN_GAPS.length}</span>}
      >
        <p className="hint">
          The knowledge base holds no approved figure for these topics, so the pipeline refuses rather than
          estimating:
        </p>
        <div className="cfield" style={{ borderBottom: 0 }}>
          <div className="srcs">
            {KNOWN_GAPS.map(gap => (
              <span className="chip warn" key={gap}>
                {gap}
              </span>
            ))}
          </div>
        </div>
      </Card>

      <Card title="Retrieval" lede={`${KB.length} knowledge-base chunks`}>
        <p className="hint">
          Okapi BM25 over stemmed tokens plus a curated topical channel, fused with reciprocal rank fusion.
          BM25 carries the exact identifiers dense retrieval misses: gene counts, “FFPE”, “MSI”. RRF is used
          instead of score interpolation because the channels are on incomparable scales.
        </p>
      </Card>

      <Card title="Known limitations" lede="what this does not claim">
        <p className="hint">
          CMS utilization is annual, covers Original Medicare fee-for-service only, and suppresses counts
          below 11. City-level trial activity does not prove a physician is an investigator. NPPES is
          self-reported and does not validate licensure. Open Payments reflects reported industry transfers,
          not clinical preference. No score represents clinical quality or treatment suitability. Decision
          support only, not for clinical use.
        </p>
      </Card>

      <Card title="Evaluation" lede="40 golden cases, executable">
        <p className="hint">
          Run <span className="mono">npm run eval</span> for the adversarial golden set: fabricated numbers,
          uncited claims, poisoned CRM notes, and cross-source contradictions. It exits non-zero on any
          failure so it can gate CI.
        </p>
      </Card>
    </div>
  );
}

function Gate({
  n,
  name,
  desc,
  on,
  note,
}: {
  n: number;
  name: string;
  desc: string;
  on: boolean;
  note?: string;
}) {
  return (
    <div className={`row-line${on ? '' : ' muted'}`}>
      {on ? <Check style={{ color: 'var(--green)' }} /> : <X style={{ color: 'var(--ink-4)' }} />}
      <span className="label">
        {n} · {name}
        <small>{desc}</small>
      </span>
      <span className={`tag ${on ? 'exact' : ''}`}>{note ?? 'ALWAYS'}</span>
    </div>
  );
}
