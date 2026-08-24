/**
 * "Why now": the half of the brief's framing that a static profile cannot answer.
 *
 * A reason to call is not a standing fact about a physician; it is a DATED
 * EVENT that decays. This module turns the sources already in the pipeline into
 * triggers, each carrying its own date, source link and freshness, so the pitch
 * can say why this week rather than asserting general relevance.
 */
import type { PaymentSummary } from './openpayments';
import type { Publication, Study } from '../types';

export type TriggerKind = 'regulatory' | 'research' | 'trial' | 'commercial';

/** Whether this reason is about this physician, or true of the whole market. */
export type TriggerScope = 'physician' | 'market';

export type Trigger = {
  kind: TriggerKind;
  scope: TriggerScope;
  /** Third person, for the rep's own reading. */
  headline: string;
  /** Second person, for copy that is spoken to the physician. */
  spoken: string;
  date: string;
  ageDays: number;
  sourceUrl: string;
  source: string;
  /** 0–100, decaying with age. Drives ordering, not truth. */
  strength: number;
};

const DAY = 86_400_000;

/** Below this, an event is history rather than a reason to call this week. */
const MIN_STRENGTH = 30;
const ageInDays = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / DAY));

/** Linear decay to zero at `horizon` days. Recency is the whole point of a trigger. */
const decay = (ageDays: number, horizon: number) => Math.max(0, Math.round((1 - ageDays / horizon) * 100));

/**
 * Regulatory actions on the assay itself, from FDA PMA P210011. Market-wide
 * rather than physician-specific, but genuinely dated, unlike "we are FDA
 * approved", which is true every day and therefore never a reason to call.
 */
const FDA_ACTIONS: Array<{ date: string; label: string; phrase: string }> = [
  { date: '2026-05-28', label: 'FDA approved a labeling supplement for xT CDx', phrase: 'the FDA labeling update for xT CDx' },
  { date: '2025-06-27', label: 'FDA approved an xT CDx labeling update', phrase: 'the FDA labeling update for xT CDx' },
  { date: '2023-04-28', label: 'xT CDx received FDA premarket approval', phrase: 'the FDA approval of xT CDx' },
];
const FDA_URL = 'https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpma/pma.cfm?id=P210011';

export type TriggerInput = {
  publications: Publication[];
  payments?: PaymentSummary;
  trials: Study[];
  /** Free text describing what this physician treats, used to match trials. */
  interest?: string;
};

export function buildTriggers({ publications, payments, trials, interest }: TriggerInput): Trigger[] {
  const triggers: Trigger[] = [];

  // 1. Regulatory: most recent action only, within two years.
  for (const action of FDA_ACTIONS) {
    const age = ageInDays(action.date);
    if (age > 730) continue;
    triggers.push({
      kind: 'regulatory',
      scope: 'market',
      headline: `${action.label} in ${monthYear(action.date)}`,
      spoken: `${action.phrase} in ${monthYear(action.date)}`,
      date: action.date,
      ageDays: age,
      sourceUrl: FDA_URL,
      source: 'FDA PMA P210011',
      strength: decay(age, 730),
    });
    break;
  }

  // 2. Research: this physician published recently. Specific to them.
  const dated = publications
    .map(p => ({ publication: p, iso: parseDate(p.date) }))
    .filter((p): p is { publication: Publication; iso: string } => Boolean(p.iso))
    .sort((a, b) => b.iso.localeCompare(a.iso));
  if (dated.length) {
    const { publication, iso } = dated[0];
    const age = ageInDays(iso);
    if (age <= 540) {
      triggers.push({
        kind: 'research',
        scope: 'physician',
        headline: `they published on ${shorten(publication.title)} in ${monthYear(iso)}`,
        spoken: `your ${monthYear(iso)} paper on ${shorten(publication.title)}`,
        date: iso,
        ageDays: age,
        sourceUrl: publication.sourceUrl,
        source: 'PubMed',
        strength: decay(age, 540),
      });
    }
  }

  // 3. Trials matching what they treat: not merely trials in the same city.
  const matched = matchTrialsToInterest(trials, interest);
  if (matched.length) {
    triggers.push({
      kind: 'trial',
      scope: 'physician',
      headline: `${matched.length} recruiting ${matched.length === 1 ? 'trial matches' : 'trials match'} their stated focus`,
      spoken: `${matched.length} recruiting ${matched.length === 1 ? 'trial' : 'trials'} locally in your area of focus`,
      date: new Date().toISOString().slice(0, 10),
      ageDays: 0,
      sourceUrl: 'https://clinicaltrials.gov/',
      source: 'ClinicalTrials.gov',
      strength: Math.min(80, matched.length * 16),
    });
  }

  // 4. Commercial: recent industry engagement means the category is live for them.
  if (payments?.latestDate) {
    const age = ageInDays(payments.latestDate);
    if (age <= 365) {
      const competitor = payments.competitors[0];
      triggers.push({
        kind: 'commercial',
        scope: 'physician',
        headline: competitor
          ? `${competitor} has an active reported relationship with them`
          : 'they have recent reported industry engagement',
      // Derived from a payments record, so the spoken form must not imply the
      // rep read their research. Where a competitor is named it is a category
      // cue; otherwise this trigger is not safe to voice at all.
      spoken: competitor
        ? `that comprehensive profiling is already on your radar`
        : '',
        date: payments.latestDate,
        ageDays: age,
        sourceUrl: payments.sourceUrl,
        source: `CMS Open Payments ${payments.year}`,
        strength: decay(age, 730),
      });
    }
  }

  // Physician-specific reasons are worth more than market-wide ones, but
  // specificity weights recency rather than overriding it: a twenty-month-old
  // payment record is not a reason to call today, however specific it is.
  const weight: Record<TriggerKind, number> = { research: 1.4, commercial: 1.15, trial: 1.1, regulatory: 1 };
  return triggers
    .filter(t => t.strength >= MIN_STRENGTH)
    .sort((a, b) => b.strength * weight[b.kind] - a.strength * weight[a.kind]);
}

/** Keyword profile of what a physician treats, from their stated interest. */
const TUMOR_TERMS: Record<string, string[]> = {
  gastrointestinal: ['colorectal', 'colon', 'rectal', 'gastric', 'pancreatic', 'esophageal', 'hepatocellular'],
  hematologic: ['leukemia', 'lymphoma', 'myeloma', 'myelodysplastic'],
  melanoma: ['melanoma', 'skin'],
  breast: ['breast'],
  genitourinary: ['prostate', 'bladder', 'renal', 'kidney', 'urothelial'],
  lung: ['lung', 'nsclc', 'mesothelioma'],
  gynecologic: ['ovarian', 'cervical', 'endometrial', 'uterine'],
};

export function tumorFocus(interest?: string): { area?: string; terms: string[] } {
  const lower = (interest ?? '').toLowerCase();
  for (const [area, terms] of Object.entries(TUMOR_TERMS)) {
    if (lower.includes(area) || terms.some(t => lower.includes(t))) return { area, terms };
  }
  return { terms: [] };
}

export function matchTrialsToInterest(trials: Study[], interest?: string): Study[] {
  const { terms } = tumorFocus(interest);
  if (!terms.length) return [];
  return trials.filter(study => {
    const conditions = (study.protocolSection.conditionsModule?.conditions ?? []).join(' ').toLowerCase();
    return terms.some(term => conditions.includes(term));
  });
}

function parseDate(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

const monthYear = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const shorten = (title: string) => {
  const clean = title.replace(/[.\s]+$/, '');
  return clean.length > 68 ? `${clean.slice(0, 65)}…` : clean;
};
