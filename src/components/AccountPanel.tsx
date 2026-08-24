import { AlertTriangle, Building2, Check, Users } from 'lucide-react';
import { accountAngle, type Account } from '../lib/accounts';
import { displayName, specialty } from '../lib/format';
import { Card } from './Card';

/**
 * Account view: the CMO conversation.
 *
 * A physician brief answers "what do I say to this doctor". This answers the
 * question a rep actually walks into a chief medical officer with: who do you
 * have here, what do they keep telling us, and what is a site-level decision
 * rather than an individual preference.
 */
export function AccountPanel({
  account, onSelectProvider,
}: {
  account: Account;
  onSelectProvider: (npi: string) => void;
}) {
  const shared = account.themes.filter(t => t.count > 1);

  return (
    <div className="reading">
      <section className="block">
        <header>
          <span className="eyebrow">Account angle</span>
          <span className="block-hint">
            {account.providers.length} oncologists
            {account.sites.length > 1 && ` · ${account.sites.length} sites`}
          </span>
        </header>
        <p className="block-text">{accountAngle(account)}</p>
        <footer>
          <Building2 />
          {account.probableInstitution
            ? <>Probable institution: {account.probableInstitution.name}, asserted by {account.probableInstitution.sources} source{account.probableInstitution.sources === 1 ? '' : 's'}, unverified</>
            : <>No source names this institution. Site identified by practice address only.</>}
        </footer>
      </section>

      <div className="acct-stats">
        <div><b>{account.providers.length}</b><span>oncologists</span></div>
        <div><b>{account.beneficiaries.toLocaleString()}</b><span>combined Medicare beneficiaries</span></div>
        <div><b>{account.topScore}</b><span>strongest entry point</span></div>
        <div className={account.contested ? 'warn' : ''}><b>{account.contested}</b><span>records to verify</span></div>
      </div>

      {shared.length > 0 && (
        <div className="notice warn">
          <AlertTriangle />
          <span>
            <b>{shared[0].count} physicians here independently raised “{shared[0].objection}”.</b> A concern
            repeated across a site is usually a pathway or workflow constraint, not a personal preference.
          </span>
        </div>
      )}

      <Card title="Who works here" lede={`${account.providers.length} in this territory`} open>
        {account.providers.map((provider, index) => (
          <button className="acct-row" key={provider.number} onClick={() => onSelectProvider(provider.number)}>
            <span className="rank">{index + 1}</span>
            <span className="who">
              <b>{displayName(provider)}</b>
              <small>{specialty(provider)}</small>
            </span>
            {provider.crm && <span className="chip">{provider.crm.objection}</span>}
            {provider.consensus.contested > 0 && (
              <AlertTriangle style={{ width: 13, color: 'var(--amber)' }} />
            )}
            <span className="sc">{provider.score}</span>
          </button>
        ))}
      </Card>

      <Card
        title="Concerns raised at this site"
        lede={account.themes.length ? `${account.themes.length} distinct` : 'none recorded'}
        aside={<span className="chip sim">SIMULATED</span>}
      >
        {account.themes.length ? (
          account.themes.map(theme => (
            <div className="row-line" key={theme.objection}>
              {theme.count > 1
                ? <AlertTriangle style={{ color: 'var(--amber)' }} />
                : <Check style={{ color: 'var(--ink-4)' }} />}
              <span className="label">
                {theme.objection}
                <small>{theme.count === 1 ? 'raised by one physician' : `raised independently by ${theme.count} physicians`}</small>
              </span>
              <span className="tag">{theme.count}×</span>
            </div>
          ))
        ) : (
          <p className="hint">No CRM concerns recorded at this site.</p>
        )}
      </Card>

      <section className="block">
        <header><span className="eyebrow">Site</span><Users style={{ width: 13, color: 'var(--ink-4)' }} /></header>
        <p className="block-text muted">
          {account.sites.map(site => <span key={site} style={{ display: 'block' }}>{site}</span>)}
          {account.city}, {account.state} {account.zip}
          <br />
          <br />
          Physicians are grouped by the institution a source named for them, falling back to their
          NPPES practice address. Suite and floor are ignored and adjacent street numbers are treated
          as one campus, so a multi-building site resolves to a single account.
        </p>
      </section>
    </div>
  );
}
