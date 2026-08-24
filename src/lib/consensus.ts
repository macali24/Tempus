/**
 * Cross-source contradiction detection.
 *
 * Six sources make overlapping claims about the same physician. A naive tool
 * silently picks one and presents it as fact. The failure mode reps actually
 * care about is walking into a meeting with stale information, a doctor who
 * moved institutions, or a directory record that was never updated.
 *
 * This module clusters assertions per field, decides whether the sources agree,
 * and downgrades identity confidence when they do not. Contested facts are
 * surfaced to the rep rather than resolved behind their back.
 */
import { institutionSimilarity, normalizeCity, SOURCE_LABEL, type Assertion, type AssertionField, type ResolvedEntity } from './entities';

export type ConsensusStatus = 'agreed' | 'contested' | 'single-source';

export type FieldConsensus = {
  field: AssertionField;
  label: string;
  status: ConsensusStatus;
  /** Confidence-weighted winning value. */
  value: string;
  /** 0–1 share of weighted support behind the winning value. */
  agreement: number;
  supporting: Assertion[];
  conflicting: Assertion[];
};

export type ConsensusReport = {
  fields: FieldConsensus[];
  /** 0–100 overall identity confidence after contradiction penalties. */
  confidence: number;
  contested: number;
  verifyBeforeCalling: boolean;
  warnings: string[];
  /** Count of sources that produced an exact-NPI join. */
  exactJoins: number;
  probabilisticJoins: number;
};

/**
 * Sources disagree on casing as well as content. NPPES stores "CHICAGO"; CMS
 * stores "Chicago". Normalising presentation keeps a formatting artefact from
 * reading as a data conflict in rep-facing copy.
 */
function displayValue(field: AssertionField, value: string): string {
  if (field === 'practiceCity' || field === 'institution') {
    return value.replace(/\w\S*/g, word => (word.length > 3 && word === word.toUpperCase() ? word[0] + word.slice(1).toLowerCase() : word));
  }
  return value;
}

const FIELD_LABEL: Record<AssertionField, string> = {
  practiceCity: 'Practice city',
  institution: 'Institution',
  specialty: 'Specialty',
  activeStatus: 'Registry status',
};

/** Per-field equivalence. Casing and formatting differences are not disagreements. */
function sameValue(field: AssertionField, a: string, b: string): boolean {
  if (field === 'practiceCity') return normalizeCity(a) === normalizeCity(b);
  if (field === 'institution') return institutionSimilarity(a, b) >= 0.5;
  if (field === 'specialty') {
    const norm = (v: string) => v.toLowerCase().replace(/[^a-z]/g, '');
    // Taxonomy strings nest ("Allopathic…|Internal Medicine|Hematology & Oncology"),
    // so containment counts as agreement rather than conflict.
    const na = norm(a);
    const nb = norm(b);
    return na.includes(nb) || nb.includes(na);
  }
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function clusterField(field: AssertionField, assertions: Assertion[]): FieldConsensus | undefined {
  if (!assertions.length) return undefined;

  const clusters: Array<{ value: string; members: Assertion[]; weight: number }> = [];
  for (const assertion of assertions) {
    const existing = clusters.find(c => sameValue(field, c.value, assertion.value));
    if (existing) {
      existing.members.push(assertion);
      existing.weight += assertion.confidence;
    } else {
      clusters.push({ value: assertion.value, members: [assertion], weight: assertion.confidence });
    }
  }
  clusters.sort((a, b) => b.weight - a.weight);

  const winner = clusters[0];
  const totalWeight = clusters.reduce((sum, c) => sum + c.weight, 0) || 1;
  const distinctSources = new Set(assertions.map(a => a.source)).size;

  const status: ConsensusStatus =
    clusters.length > 1 ? 'contested' : distinctSources > 1 ? 'agreed' : 'single-source';

  return {
    field,
    label: FIELD_LABEL[field],
    status,
    value: displayValue(field, winner.value),
    agreement: Math.round((winner.weight / totalWeight) * 100) / 100,
    supporting: winner.members,
    conflicting: clusters.slice(1).flatMap(c => c.members),
  };
}

export function buildConsensus(entity: ResolvedEntity): ConsensusReport {
  const byField = new Map<AssertionField, Assertion[]>();
  for (const assertion of entity.assertions) {
    byField.set(assertion.field, [...(byField.get(assertion.field) ?? []), assertion]);
  }

  const fields = (['practiceCity', 'institution', 'specialty', 'activeStatus'] as AssertionField[])
    .map(field => clusterField(field, byField.get(field) ?? []))
    .filter((f): f is FieldConsensus => Boolean(f));

  const contested = fields.filter(f => f.status === 'contested').length;
  const exactJoins = entity.links.filter(l => l.matched && l.method === 'npi-exact').length;
  const probabilisticJoins = entity.links.filter(l => l.matched && l.method !== 'npi-exact').length;

  // Confidence starts from corroboration breadth, then pays a penalty per
  // contested field. Exact joins are worth materially more than fuzzy ones.
  const corroboration = Math.min(60, exactJoins * 18 + probabilisticJoins * 6);
  const agreementBonus = fields.length
    ? Math.round((fields.reduce((sum, f) => sum + f.agreement, 0) / fields.length) * 40)
    : 0;
  const confidence = Math.max(0, Math.min(100, corroboration + agreementBonus - contested * 15));

  const warnings: string[] = [];
  for (const field of fields.filter(f => f.status === 'contested')) {
    const alt = field.conflicting[0];
    warnings.push(
      `${field.label}: ${field.supporting.length} source${field.supporting.length === 1 ? '' : 's'} report “${field.value}”, but ${SOURCE_LABEL[alt.source]} reports “${displayValue(field.field, alt.value)}”${alt.observedAt ? ` (${alt.observedAt})` : ''}. Verify before calling.`,
    );
  }
  if (!entity.links.find(l => l.source === 'cms-utilization')?.matched) {
    warnings.push('No CMS Medicare utilization record matched this NPI, so opportunity sizing is unavailable rather than estimated.');
  }
  for (const field of fields.filter(f => f.status === 'single-source')) {
    warnings.push(`${field.label} is asserted by only one source (${SOURCE_LABEL[field.supporting[0].source]}) and is unverified.`);
  }

  return {
    fields,
    confidence,
    contested,
    verifyBeforeCalling: contested > 0 || confidence < 50,
    warnings,
    exactJoins,
    probabilisticJoins,
  };
}
