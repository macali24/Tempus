import { AlertTriangle, Check, ExternalLink, Minus, X } from 'lucide-react';
import { SOURCE_LABEL, type SourceLink } from '../lib/entities';
import type { FieldConsensus } from '../lib/consensus';
import { rankSensitivity, type ScoredProvider } from '../lib/ranking';
import { AuditCard, type AuditSummary } from './AuditCard';
import { Card } from './Card';

/**
 * Answers "can I trust this?" in one line, with the working shown on request.
 */
export function TrustPanel({ provider, all, audit }: {
  provider: ScoredProvider;
  all: ScoredProvider[];
  audit: AuditSummary;
}) {
  const { entity, consensus } = provider;
  const sensitivity = rankSensitivity(all, provider);
  const tone = consensus.confidence >= 70 ? 'ok' : consensus.confidence >= 45 ? 'warn' : 'bad';

  return (
    <div className="reading">
      <div className={`notice ${consensus.verifyBeforeCalling ? 'warn' : 'info'}`}>
        {consensus.verifyBeforeCalling ? <AlertTriangle /> : <Check />}
        <span>
          {consensus.verifyBeforeCalling ? (
            <>
              <b>Verify before calling.</b>{' '}
              {consensus.contested > 0
                ? `${consensus.contested} field${consensus.contested === 1 ? '' : 's'} disagree across sources.`
                : 'Corroboration is thin for this record.'}
            </>
          ) : (
            <>
              <b>Corroborated.</b> {consensus.exactJoins} exact NPI joins agree across every shared field.
            </>
          )}
        </span>
      </div>

      <AuditCard audit={audit} />

      <Card
        id="ev-identity"
        title="Identity confidence"
        lede={`${consensus.exactJoins} exact · ${consensus.probabilisticJoins} probabilistic`}
        aside={
          <span className={`chip ${tone}`}>
            <span className="dot" />
            {consensus.confidence}/100
          </span>
        }
        open
      >
        {entity.links.map(link => (
          <SourceRow key={link.source} link={link} />
        ))}
      </Card>

      <Card
        id="ev-consensus"
        title="Cross-source consensus"
        lede={consensus.contested > 0 ? `${consensus.contested} contested` : 'all fields agree'}
        aside={
          consensus.contested > 0 ? (
            <span className="chip warn">
              <AlertTriangle />
              {consensus.contested}
            </span>
          ) : (
            <span className="chip ok">
              <Check />
              clean
            </span>
          )
        }
        open={consensus.contested > 0}
      >
        {consensus.fields.map(field => (
          <ConsensusField key={field.field} field={field} />
        ))}
      </Card>

      {consensus.warnings.length > 0 && (
        <Card
          id="ev-queue"
          title="Verification queue"
          lede={`${consensus.warnings.length} item${consensus.warnings.length === 1 ? '' : 's'}`}
        >
          {consensus.warnings.map(warning => (
            <div className="notice warn" key={warning} style={{ marginBottom: 8 }}>
              <AlertTriangle />
              <span>{warning}</span>
            </div>
          ))}
        </Card>
      )}

      <Card
        id="ev-opportunity"
        title="Patient opportunity"
        lede={provider.estimatedPatients ? `~${provider.estimatedPatients.toLocaleString()} est. annual patients` : 'no vendor estimate'}
        aside={provider.opportunityCorroborated
          ? <span className="chip ok"><Check />corroborated</span>
          : <span className="chip warn"><AlertTriangle />unverified</span>}
      >
        <p className="hint">
          The figure comes from the vendor market-intelligence CSV and is a <b>modelled estimate,
          not a count</b>. It answers the brief's “likely size of patient population”, and it is the
          only number here that no federal source can confirm outright.
        </p>
        <dl className="kv">
          <dt>Vendor estimate</dt><dd>{provider.estimatedPatients?.toLocaleString() ?? 'n/a'}</dd>
          <dt>Segment</dt><dd style={{ fontFamily: 'var(--sans)' }}>{provider.segment ?? 'n/a'}</dd>
          <dt>CMS beneficiaries</dt><dd>{provider.utilization?.beneficiaries?.toLocaleString() ?? 'none'}</dd>
        </dl>
        <p className="hint" style={{ marginTop: 11 }}>
          {provider.opportunityCorroborated
            ? 'A CMS Medicare record exists for this physician, so the estimate has independent support and is scored at full weight.'
            : 'No CMS Medicare record corroborates this estimate, so its contribution to the score is reduced by 30%.'}
        </p>
      </Card>

      <Card id="ev-rank" title="Why this rank" lede={`score ${provider.score}/100`}>
        {provider.components.map(component => (
          <div className="wbar" key={component.key}>
            <span className="lbl">{component.label}</span>
            <span className="track">
              <i style={{ width: `${component.value}%` }} />
            </span>
            <span className="num">{component.value}</span>
          </div>
        ))}

        <p className="hint" style={{ marginTop: 18 }}>
          <b>If a signal were missing</b>, this provider would rank:
        </p>
        {sensitivity.slice(0, 4).map(row => (
          <div className="sens" key={row.key}>
            <span className="lbl">{row.label}</span>
            <span className="rk">
              #{row.baseline} → #{row.without}
            </span>
            <span className={`dl ${row.delta > 0 ? 'up' : row.delta < 0 ? 'down' : 'flat'}`}>
              {row.delta > 0 ? `+${row.delta}` : row.delta === 0 ? '0' : row.delta}
            </span>
          </div>
        ))}
      </Card>

      <Card
        id="ev-panel"
        title="Best-fit panel"
        lede={provider.panelAssay}
        aside={<span className="chip accent">{provider.panelFit}/100</span>}
      >
        <p className="hint">{provider.panelRationale}</p>
        {provider.panelEligiblePatients > 0 && (
          <p className="hint">
            <b>~{provider.panelEligiblePatients.toLocaleString()} patients/year</b> fit this panel:
            {' '}{provider.estimatedPatients?.toLocaleString()} estimated annual patients
            {' '}× indication fit × likelihood of testing. Modelled on vendor data, not a count.
          </p>
        )}
      </Card>

      {provider.payments && provider.payments.records > 0 && (
        <Card
          id="ev-payments"
          title="Industry relationships"
          lede={`${provider.payments.records} payments · ${provider.payments.manufacturers.length} manufacturers`}
          aside={
            provider.payments.competitors.length ? (
              <span className="chip warn">{provider.payments.competitors.length} competitor</span>
            ) : undefined
          }
        >
          <dl className="kv">
            <dt>Reported total</dt>
            <dd>${provider.payments.totalUsd.toLocaleString()}</dd>
            <dt>Most recent</dt>
            <dd>{provider.payments.latestDate ?? 'n/a'}</dd>
          </dl>
          {provider.payments.competitors.length > 0 && (
            <div className="notice info" style={{ marginTop: 12 }}>
              <AlertTriangle />
              <span>
                Already engaged by {provider.payments.competitors.join(', ')}. This is a displacement
                conversation, not an education one.
              </span>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function SourceRow({ link }: { link: SourceLink }) {
  return (
    <div className={`row-line${link.matched ? '' : ' muted'}`}>
      {link.matched ? (
        <Check style={{ color: 'var(--green)' }} />
      ) : (
        <Minus style={{ color: 'var(--ink-4)' }} />
      )}
      <span className="label">
        {SOURCE_LABEL[link.source]}
        <small>{link.detail}</small>
      </span>
      <span className={`tag ${link.matched ? (link.method === 'npi-exact' ? 'exact' : 'fuzzy') : ''}`}>
        {link.matched
          ? link.method === 'npi-exact'
            ? 'NPI EXACT'
            : `${Math.round(link.confidence * 100)}% FUZZY`
          : 'NO MATCH'}
      </span>
    </div>
  );
}

function ConsensusField({ field }: { field: FieldConsensus }) {
  const tone = field.status === 'agreed' ? 'ok' : field.status === 'contested' ? 'warn' : '';
  const Icon = field.status === 'agreed' ? Check : field.status === 'contested' ? X : Minus;
  return (
    <div className="cfield">
      <div className="top">
        <b>{field.label}</b>
        <span className={`chip ${tone}`}>
          <Icon />
          {field.status}
        </span>
      </div>
      <div className="val">{field.value}</div>
      <div className="srcs">
        {field.supporting.map(a => (
          <span className="chip" key={`${a.source}-${a.value}`}>
            {SOURCE_LABEL[a.source]}
          </span>
        ))}
      </div>
      {field.conflicting.map(a => (
        <div className="clash" key={`${a.source}-${a.value}`}>
          {SOURCE_LABEL[a.source]} reports <b>{a.value}</b>
          {a.observedAt ? ` (${a.observedAt})` : ''}
          {a.url && (
            <>
              {' '}
              ·{' '}
              <a href={a.url} target="_blank" rel="noreferrer">
                source <ExternalLink style={{ width: 11, display: 'inline', verticalAlign: -2 }} />
              </a>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
