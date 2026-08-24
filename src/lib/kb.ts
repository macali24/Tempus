/**
 * Product knowledge base.
 *
 * Each chunk carries an evidence GRADE modelled on the hierarchy oncologists
 * already use, so a claim's strength is visible at the point of use:
 *
 *   A: FDA labeling / regulatory document
 *   B: peer-reviewed literature
 *   C: company technical or product documentation
 *   D: inference (never citable; the validator blocks grade-D claims)
 *
 * `text` is the retrievable span. The validator checks generated numbers against
 * these exact strings, so they must be transcribed verbatim from the source.
 */
export type EvidenceGrade = 'A' | 'B' | 'C' | 'D';

/**
 * The corpus is INGESTED, not hand-written: `npm run kb` parses /kb/*.md into
 * kb.generated.ts. Product facts therefore live in reviewable documents that
 * carry their own source and access date, and the numbers below are transcribed
 * verbatim from FDA PMA P210011 and its Summary of Safety and Effectiveness
 * Data rather than paraphrased.
 */
import { GENERATED_KB } from './kb.generated';

export type KbChunk = {
  id: string;
  assay: 'xT CDx' | 'xF' | 'xM' | 'xR' | 'platform';
  section: string;
  text: string;
  grade: EvidenceGrade;
  source: string;
  url: string;
  accessed: string;
  /** Topics used for objection routing; also boosts lexical retrieval. */
  topics: string[];
  /**
   * A short, speakable form of the same claim, for the deterministic path.
   * Every number in a headline must also appear in `text`, since that is what
   * the numeric guard checks against; the short form is not a licence to drift.
   */
  headline?: string;
};

export const KB: KbChunk[] = GENERATED_KB;

/** Deliberately unsupported topics. Used by the eval suite to prove the tool fails closed. */
/**
 * Topics the corpus genuinely cannot support.
 *
 * Turnaround time is here on evidence, not by omission: it appears nowhere in
 * FDA PMA P210011, its SSED, or the Tempus xT CDx Technical Information sheet.
 * Rather than quote an unapproved figure, the objection handler refuses and
 * pivots to the strongest supported evidence plus a discovery question.
 */
/**
 * Topics the corpus genuinely does not cover. A brief on any of these refuses
 * and pivots rather than guessing.
 *
 * Turnaround time was on this list until an approved source existed for it. It
 * came off only because Tempus states the figure in its FY2025 Form 10-K, which
 * is dated, attributable and quotable, not because the example demanded it.
 * Pricing has no such source, so it stays.
 */
export const KNOWN_GAPS = ['cost and coverage', 'reimbursement', 'price'];

export const gradeLabel: Record<EvidenceGrade, string> = {
  A: 'FDA labeling / regulatory',
  B: 'Peer-reviewed literature',
  C: 'Company technical documentation',
  D: 'Inference, not citable',
};
