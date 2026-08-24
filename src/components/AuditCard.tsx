import { Check, ExternalLink, SkipForward, X } from 'lucide-react';
import { GATE_LABEL, type EvidenceItem, type GateResult, type ValidatedClaim } from '../lib/validator';
import { gradeLabel } from '../lib/kb';
import { Card } from './Card';

/**
 * What the generator produced and what survived validation.
 *
 * Reported up out of BriefPanel rather than recomputed, because a second
 * generation pass would be a different sample of the same pipeline; the
 * audit has to describe the copy the rep is actually reading.
 */
export type AuditSummary = {
  claims: ValidatedClaim[];
  verified: number;
  withheld: number;
  sources: EvidenceItem[];
  blocked: boolean;
  /** Why the CRM note was rejected at gate 1, when it was. */
  blockedReason?: string;
  /** Gate 4 needs a second model credential; without one it is skipped, not passed. */
  entailmentRan: boolean;
  /** False while generation is still running, so callers can show a dash. */
  ready: boolean;
};

export const NO_AUDIT: AuditSummary = {
  claims: [], verified: 0, withheld: 0, sources: [],
  blocked: false, entailmentRan: false, ready: false,
};

/**
 * The audit surface for the generated copy.
 *
 * It sits under "Evidence & verification" with the record-level cards rather
 * than inside the prep sheet: the rule promises everything the copy rests on,
 * and this is the part that rests closest to it. Collapsed by default, at rest
 * it is one line stating how many claims cleared how many gates.
 */
export function AuditCard({ audit }: { audit: AuditSummary }) {
  if (!audit.ready) return null;

  return (
    <Card
      id="ev-audit"
      title="How this was checked"
      lede={audit.blocked
        ? 'Nothing was generated from this note, so there is nothing to check'
        : `${audit.claims.length} claims · ${audit.sources.length} sources`}
      aside={audit.blocked
        ? <span className="chip bad"><X />Input blocked at gate 1</span>
        : audit.withheld > 0
          ? <span className="chip bad"><X />{audit.withheld} withheld</span>
          : audit.entailmentRan
            ? <span className="chip ok"><Check />4 gates passed</span>
            : <span className="chip warn"><Check />3 deterministic gates passed · independent model check not configured</span>}
    >
      {audit.claims.map((claim, i) => <ClaimRow key={i} claim={claim} />)}

      {audit.sources.length > 0 && <h4 className="audit-sub">Sources cited</h4>}
      {audit.sources.map(item => (
        <div className="evi" key={item.id}>
          <span className={`grade ${item.grade}`}>{item.grade}</span>
          <span className="txt">
            {item.kind === 'kb' ? item.text : `${item.label}: ${item.value}`}
            <small>{item.kind === 'kb' ? `${item.source} · accessed ${item.accessed}` : item.source} · {gradeLabel[item.grade]}</small>
          </span>
          {item.url && <a href={item.url} target="_blank" rel="noreferrer" title="Open source"><ExternalLink /></a>}
        </div>
      ))}
    </Card>
  );
}

function ClaimRow({ claim }: { claim: ValidatedClaim }) {
  return (
    <div className={`claim ${claim.verdict === 'accepted' ? 'ok' : 'bad'}`}>
      <div className="text">{claim.text}</div>
      <div className="meta">
        {claim.grade && <span className={`grade ${claim.grade}`}>{claim.grade}</span>}
        <div className="gates">{claim.gates.map(g => <GateChip key={g.gate} gate={g} />)}</div>
      </div>
      {claim.withheldReason && <div className="why"><b>Withheld: </b>{claim.withheldReason}</div>}
    </div>
  );
}

function GateChip({ gate }: { gate: GateResult }) {
  const Icon = gate.status === 'pass' ? Check : gate.status === 'fail' ? X : SkipForward;
  const cls = gate.status === 'pass' ? 'pass' : gate.status === 'fail' ? 'fail' : 'skip';
  return <span className={`gate ${cls}`} title={gate.reason}><Icon />{GATE_LABEL[gate.gate]}</span>;
}
