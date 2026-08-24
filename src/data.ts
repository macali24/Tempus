/**
 * CRM notes.
 *
 * The records themselves live in `data/crm/*.txt`, one plain-text file per
 * physician, written the way a Salesforce note actually looks. `npm run ingest`
 * parses them, and the objection is EXTRACTED from the prose rather than read
 * from a labelled field, because real notes do not arrive with an enum attached.
 *
 * Two files are deliberately adversarial: one carries a prompt-injection
 * payload and one carries PHI-shaped text. Both are blocked by the validator's
 * input screen and are shown as live demonstrations, not accidents.
 */
import { GENERATED_CRM } from './lib/crm.generated';
import { providerMatchesName } from './lib/matching';
import type { CrmNote, Provider } from './types';

export const simulatedCrm = GENERATED_CRM;

/** Exact NPI plus a live-name check before a CRM note may affect a doctor. */
export function crmNoteFor(provider: Provider): CrmNote | undefined {
  const note = simulatedCrm[provider.number];
  return note && providerMatchesName(provider, note.physician) ? note : undefined;
}
