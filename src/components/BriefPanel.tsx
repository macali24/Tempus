import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Check, Clock, Copy, ExternalLink, FlaskConical, Loader2,
  RefreshCw, ShieldCheck, Sparkles,
} from 'lucide-react';
import { generateBrief, type GeneratedBrief } from '../lib/generate';
import { fetchPublications } from '../api';
import type { Trigger } from '../lib/triggers';
import type { ScoredProvider } from '../lib/ranking';
import type { Publication } from '../types';
import type { AuditSummary } from './AuditCard';

/**
 * The prep sheet.
 *
 * A fifteen-minute meeting runs: you open, they push back, you answer. So the
 * page is why-now, the opener, and the expected objection with its response,
 * in that order, on one scroll, and nothing else. The pipeline's internals
 * (retrieval, claim validation, sources) are reported up to `onAudit` and drawn
 * under "Evidence & verification" instead: they are how the copy was produced,
 * not what the rep came here to read.
 */
export function BriefPanel({ provider, onAudit }: { provider: ScoredProvider; onAudit?: (a: AuditSummary) => void }) {
  const [opener, setOpener] = useState<GeneratedBrief | null>(null);
  const [objection, setObjection] = useState<GeneratedBrief | null>(null);
  const [busy, setBusy] = useState(true);
  const [nonce, setNonce] = useState(0);
  // Held in a ref so a caller passing an inline arrow does not re-run the
  // report effect on every render of the stage.
  const report = useRef(onAudit);
  report.current = onAudit;

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setBusy(true);
    setOpener(null);
    setObjection(null);

    (async () => {
      // Publications are a per-physician "why now" signal, so they are fetched
      // before generation rather than shown as a separate list.
      const publications: Publication[] = await fetchPublications(provider, controller.signal).catch(() => []);
      if (!live) return;
      const [a, b] = await Promise.all([
        generateBrief('script', provider, provider.payments, publications),
        generateBrief('objection', provider, provider.payments, publications),
      ]);
      if (!live) return;
      setOpener(a);
      setObjection(b);
      setBusy(false);
    })();

    return () => {
      live = false;
      controller.abort(new DOMException('Superseded provider brief', 'AbortError'));
    };
  }, [provider.number, nonce]);

  const triggers = opener?.triggers ?? [];
  const blocked = opener?.report.inputScreen.status === 'fail';
  const allClaims = [...(opener?.report.claims ?? []), ...(objection?.report.claims ?? [])];
  const withheld = allClaims.filter(c => c.verdict === 'withheld').length;
  const sources = dedupe([...(opener?.evidencePool ?? []), ...(objection?.evidencePool ?? [])]);
  // Gate 4 needs a second model credential. Without one the deterministic gates
  // still run, but saying "all verified" would overstate what was checked.
  const entailmentRan = [opener?.report.verifier, objection?.report.verifier]
    .some(v => v && v !== 'none');
  const verified = (opener?.report.accepted ?? 0) + (objection?.report.accepted ?? 0);

  // The audit surface renders under "Evidence & verification", not here, and
  // the stage header uses these counts as jump targets. Both read the pipeline
  // output reported up from this pass rather than triggering a second one.
  useEffect(() => {
    report.current?.({
      claims: allClaims, verified, withheld, sources,
      blocked, blockedReason: opener?.report.inputScreen.reason,
      entailmentRan, ready: !busy,
    });
  }, [busy, allClaims.length, verified, withheld, sources.length, blocked, entailmentRan, provider.number, nonce]);

  return (
    <div className="reading">
      {/* ---------------------------------------------------------- why now */}
      <section className="why-now">
        <div className="why-head">
          <Clock />
          <span className="eyebrow">Why now</span>
          <button className="icon-btn" onClick={() => setNonce(n => n + 1)} title="Regenerate"><RefreshCw /></button>
        </div>
        {busy ? (
          <p className="why-empty">Checking recent activity…</p>
        ) : triggers.length ? (
          <ul className="trigger-list">
            {triggers.filter(t => t.scope === 'physician').slice(0, 3)
              .map(t => <TriggerRow key={t.kind + t.date} trigger={t} />)}
            {triggers.filter(t => t.scope === 'market').slice(0, 1)
              .map(t => <TriggerRow key={t.kind + t.date} trigger={t} market />)}
          </ul>
        ) : (
          <p className="why-empty">No dated trigger found. Lead with discovery rather than urgency.</p>
        )}
      </section>

      {blocked && (
        <div className="notice bad">
          <AlertTriangle />
          <span><b>This CRM note was blocked.</b> {opener!.report.inputScreen.reason} Nothing generated from it was trusted.</span>
        </div>
      )}

      {/* ----------------------------------------------------------- opener */}
      <Block
        label="Your opener"
        hint="30 seconds"
        speak
        text={opener?.body}
        busy={busy}
        verified={opener?.report.accepted}
      />

      {/* -------------------------------------------------------- objection */}
      <Block
        label="Expect pushback on"
        hint={provider.crm?.objection}
        note={provider.crm ? { text: provider.crm.note, date: provider.crm.lastContact } : undefined}
        text={objection?.body}
        busy={busy}
        gap={objection?.gap}
      />
    </div>
  );
}

const TRIGGER_ICON = { research: FlaskConical, regulatory: ShieldCheck, trial: Sparkles, commercial: Sparkles };

function TriggerRow({ trigger, market }: { trigger: Trigger; market?: boolean }) {
  const Icon = TRIGGER_ICON[trigger.kind];
  return (
    <li className={market ? 'market-scope' : ''}>
      <span className="t-icon"><Icon /></span>
      <span className="t-text">
        {capitalize(trigger.headline)}
        {market && <em> · market-wide</em>}
      </span>
      <a className="t-src" href={trigger.sourceUrl} target="_blank" rel="noreferrer">
        {trigger.ageDays === 0 ? 'current' : `${trigger.ageDays}d ago`} <ExternalLink />
      </a>
    </li>
  );
}

function Block({
  label, hint, text, busy, verified, note, gap, speak,
}: {
  label: string; hint?: string; text?: string; busy: boolean;
  verified?: number; note?: { text: string; date: string }; gap?: string; speak?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <section className={`block${speak ? ' speak' : ''}`}>
      <header>
        <span className="eyebrow">{label}</span>
        {hint && <span className="block-hint">{hint}</span>}
        {note && <span className="chip sim">SIMULATED</span>}
        <button
          className={`icon-btn${copied ? ' done' : ''}`}
          disabled={!text}
          title={copied ? 'Copied' : 'Copy'}
          onClick={() => { if (text) { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1400); } }}
        >
          {copied ? <Check /> : <Copy />}
        </button>
      </header>

      {note && <blockquote className="crm-quote">“{note.text}” <cite>CRM · {note.date}</cite></blockquote>}

      <p className={`block-text${busy || gap ? ' muted' : ''}`}>
        {busy ? <><Loader2 style={{ width: 14, display: 'inline', marginRight: 7 }} />Retrieving evidence and validating…</> : text}
      </p>

      {!busy && (gap || verified !== undefined) && (
        <footer>
          {gap
            ? <><AlertTriangle style={{ color: 'var(--amber)' }} /> No approved figure for {gap}, refused rather than estimated</>
            : <><ShieldCheck /> {verified ?? 0} claim{verified === 1 ? '' : 's'} verified against cited evidence</>}
        </footer>
      )}
    </section>
  );
}

const capitalize = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

function dedupe<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => (seen.has(item.id) ? false : (seen.add(item.id), true)));
}
