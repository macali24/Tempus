/**
 * The cross-validator.
 *
 * Generating a pitch is one model call. Knowing whether the pitch is TRUE before
 * a rep says it to a CMO is the part that has to be engineered. Every generated
 * claim passes four independent gates, and a claim that fails any gate is
 * withheld with a visible reason rather than silently dropped.
 *
 *   Gate 1  Injection / PHI screen   on untrusted CRM input, before generation
 *   Gate 2  Evidence grade           grade D (inference) is never citable
 *   Gate 3  Numeric guard            deterministic, no model call
 *   Gate 4  Entailment               a DIFFERENT model, blind to the generator
 *
 * Gate 3 is the one that matters most in practice: numbers are where
 * hallucination does the most damage and where detection is provable.
 */
import { gradeLabel, type EvidenceGrade, type KbChunk } from './kb';
import { complete, extractJson, type ProviderId } from './llm';

/** A fact drawn from live federal data rather than the product knowledge base. */
export type DataFact = {
  id: string;
  label: string;
  value: string | number;
  source: string;
  url: string;
  grade: EvidenceGrade;
};

export type EvidenceItem = ({ kind: 'kb' } & KbChunk) | ({ kind: 'data' } & DataFact);

export type Claim = { text: string; evidenceIds: string[] };

export type GateStatus = 'pass' | 'fail' | 'skipped';
export type GateName = 'injection' | 'grade' | 'numeric' | 'entailment';

export type GateResult = {
  gate: GateName;
  status: GateStatus;
  reason: string;
};

export type ValidatedClaim = {
  text: string;
  verdict: 'accepted' | 'withheld';
  grade?: EvidenceGrade;
  gates: GateResult[];
  evidence: EvidenceItem[];
  withheldReason?: string;
};

export type ValidationReport = {
  claims: ValidatedClaim[];
  accepted: number;
  withheld: number;
  generator: ProviderId;
  verifier: ProviderId | 'none';
  inputScreen: GateResult;
};

export const GATE_LABEL: Record<GateName, string> = {
  injection: 'Input screen',
  grade: 'Evidence grade',
  numeric: 'Numeric guard',
  entailment: 'Cross-model entailment',
};

/* ------------------------------------------ Gate 1: injection / PHI screen */

const INJECTION_PATTERNS: Array<[RegExp, string]> = [
  [/ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i, 'instruction override'],
  [/disregard\s+(the\s+)?(above|previous|system)/i, 'instruction override'],
  [/you\s+are\s+now\s+(a|an)\b/i, 'role reassignment'],
  [/\bsystem\s*:\s*/i, 'system-role injection'],
  [/new\s+instructions?\s*:/i, 'instruction injection'],
  [/reveal|print|output\s+(your\s+)?(system\s+)?prompt/i, 'prompt exfiltration'],
  [/\bjavascript:/i, 'script URI'],
  [/<\s*script/i, 'markup injection'],
];

const PHI_PATTERNS: Array<[RegExp, string]> = [
  [/\b\d{3}-\d{2}-\d{4}\b/, 'possible SSN'],
  [/\bMRN[:#\s]*\d+/i, 'medical record number'],
  [/\bDOB[:#\s]*\d/i, 'date of birth'],
  [/\bpatient\s+\w+\s+(has|was|is)\b/i, 'possible patient identifier'],
];

export function screenInput(text: string): GateResult {
  for (const [pattern, label] of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return { gate: 'injection', status: 'fail', reason: `Blocked untrusted CRM input: ${label} detected.` };
    }
  }
  for (const [pattern, label] of PHI_PATTERNS) {
    if (pattern.test(text)) {
      return { gate: 'injection', status: 'fail', reason: `Blocked untrusted CRM input: ${label} detected.` };
    }
  }
  return { gate: 'injection', status: 'pass', reason: 'No injection or PHI pattern detected in CRM input.' };
}

/** Neutralise a note so it can be shown without ever entering a prompt. */
export const redact = (text: string) =>
  PHI_PATTERNS.reduce((acc, [pattern]) => acc.replace(pattern, '[redacted]'), text);

/* ----------------------------------------------- Gate 2: evidence grading */

const GRADE_RANK: Record<EvidenceGrade, number> = { A: 3, B: 2, C: 1, D: 0 };

export function gradeGate(evidence: EvidenceItem[]): { result: GateResult; grade?: EvidenceGrade } {
  if (!evidence.length) {
    return { result: { gate: 'grade', status: 'fail', reason: 'No evidence cited, treated as grade D inference.' } };
  }
  // A claim is only as strong as its weakest supporting citation.
  const weakest = evidence.reduce<EvidenceGrade>((worst, item) => (GRADE_RANK[item.grade] < GRADE_RANK[worst] ? item.grade : worst), 'A');
  if (weakest === 'D') {
    return { result: { gate: 'grade', status: 'fail', reason: 'Cites a grade-D inference, which is not citable.' }, grade: weakest };
  }
  return { result: { gate: 'grade', status: 'pass', reason: `Grade ${weakest}: ${gradeLabel[weakest]}.` }, grade: weakest };
}

/* -------------------------------------------------- Gate 3: numeric guard */

/**
 * Every number in a claim must appear in its cited evidence. Deterministic, no
 * model call, and it catches the class of error that most damages credibility:
 * a confidently stated figure that nothing supports.
 */
export function numericGuard(claimText: string, evidence: EvidenceItem[]): GateResult {
  const claimNumbers = extractNumbers(claimText);
  if (!claimNumbers.length) {
    return { gate: 'numeric', status: 'pass', reason: 'No numeric assertion to verify.' };
  }
  const haystack = evidence
    .map(item => (item.kind === 'kb' ? item.text : `${item.label} ${item.value}`))
    .join(' ');
  const supported = new Set(extractNumbers(haystack));

  const unsupported = claimNumbers.filter(n => !supported.has(n));
  if (unsupported.length) {
    return {
      gate: 'numeric',
      status: 'fail',
      reason: `Number${unsupported.length === 1 ? '' : 's'} not present in cited evidence: ${unsupported.join(', ')}.`,
    };
  }
  return { gate: 'numeric', status: 'pass', reason: `Verified ${claimNumbers.length} numeric value${claimNumbers.length === 1 ? '' : 's'} against cited evidence.` };
}

/** Normalised numeric tokens: 1,234 and 1234 compare equal; 648-gene yields 648. */
export function extractNumbers(text: string): string[] {
  const matches = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return [...new Set(matches.map(m => {
    const normalized = m.replace(/,/g, '');
    return normalized.replace(/\.0+$/, '');
  }))];
}

/* ----------------------------------------------- Gate 4: cross-model check */

const ENTAILMENT_SYSTEM = `You are a strict evidence auditor for a regulated medical diagnostics company.
You will be given a CLAIM and the EVIDENCE cited for it.
Decide whether the evidence fully supports the claim.
Do not use outside knowledge. Do not be charitable. If the evidence is only partially supportive, answer "partial".
Respond ONLY with JSON: {"verdict":"supported"|"partial"|"unsupported","reason":"<one short sentence>"}`;

export async function entailmentGate(
  claimText: string,
  evidence: EvidenceItem[],
  generatorProvider: ProviderId,
): Promise<{ result: GateResult; verifier: ProviderId | 'none' }> {
  const evidenceText = evidence
    .map((item, i) => `[${i + 1}] ${item.kind === 'kb' ? item.text : `${item.label}: ${item.value}`}`)
    .join('\n');

  // The verifier must not be the generator, or this is self-grading.
  const response = await complete(`CLAIM:\n${claimText}\n\nEVIDENCE:\n${evidenceText}`, {
    system: ENTAILMENT_SYSTEM,
    exclude: [generatorProvider],
    temperature: 0,
  });

  if (response.offline) {
    return {
      result: {
        gate: 'entailment',
        status: 'skipped',
        reason: 'No independent verifier model configured; gates 1–3 still enforced.',
      },
      verifier: 'none',
    };
  }

  const parsed = extractJson<{ verdict?: string; reason?: string }>(response.text);
  const verdict = parsed?.verdict?.toLowerCase();
  if (verdict === 'supported') {
    return { result: { gate: 'entailment', status: 'pass', reason: `${response.provider} confirms the evidence supports this claim.` }, verifier: response.provider };
  }
  return {
    result: {
      gate: 'entailment',
      status: 'fail',
      reason: `${response.provider} rated this "${verdict ?? 'unparseable'}": ${parsed?.reason ?? 'no supporting span identified'}.`,
    },
    verifier: response.provider,
  };
}

/* ------------------------------------------------------------ orchestration */

export async function validateClaims(
  claims: Claim[],
  evidencePool: EvidenceItem[],
  generatorProvider: ProviderId,
  crmInput: string,
): Promise<ValidationReport> {
  const inputScreen = screenInput(crmInput);
  const byId = new Map(evidencePool.map(item => [item.id, item]));
  let verifier: ProviderId | 'none' = 'none';

  const validated: ValidatedClaim[] = [];
  for (const claim of claims) {
    const evidence = claim.evidenceIds.map(id => byId.get(id)).filter((e): e is EvidenceItem => Boolean(e));
    const gates: GateResult[] = [];

    // Gate 1 is evaluated once on the input and inherited by every claim: a
    // poisoned note invalidates everything generated downstream of it.
    gates.push(inputScreen);

    const { result: gradeResult, grade } = gradeGate(evidence);
    gates.push(gradeResult);

    gates.push(numericGuard(claim.text, evidence));

    // Only spend a model call if the cheap deterministic gates already passed.
    if (gates.every(g => g.status !== 'fail')) {
      const { result, verifier: used } = await entailmentGate(claim.text, evidence, generatorProvider);
      gates.push(result);
      if (used !== 'none') verifier = used;
    } else {
      gates.push({ gate: 'entailment', status: 'skipped', reason: 'Not run: an earlier gate already failed.' });
    }

    const failed = gates.find(g => g.status === 'fail');
    validated.push({
      text: claim.text,
      verdict: failed ? 'withheld' : 'accepted',
      grade,
      gates,
      evidence,
      withheldReason: failed?.reason,
    });
  }

  return {
    claims: validated,
    accepted: validated.filter(c => c.verdict === 'accepted').length,
    withheld: validated.filter(c => c.verdict === 'withheld').length,
    generator: generatorProvider,
    verifier,
    inputScreen,
  };
}
