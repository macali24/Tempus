/**
 * Display formatting for source data.
 *
 * NPPES stores names in upper case. Rendering "Dr. ABAZA" in a meeting script
 * makes generated copy look machine-produced, so names are title-cased for
 * presentation while the underlying record is left untouched.
 */
import type { Provider } from '../types';

const PARTICLES = new Set(['de', 'del', 'della', 'van', 'von', 'der', 'la', 'le', 'da', 'di', 'du', 'bin', 'al']);

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/(\s+|-)/)
    .map(part => {
      if (/^\s*$/.test(part) || part === '-') return part;
      if (PARTICLES.has(part)) return part;
      if (/^o'/.test(part)) return `O'${part.slice(2, 3).toUpperCase()}${part.slice(3)}`;
      if (/^mc/.test(part) && part.length > 3) return `Mc${part[2].toUpperCase()}${part.slice(3)}`;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('');
}

export const credential = (value?: string) => (value ?? '').replace(/\./g, '').trim().toUpperCase();

export const displayName = (p: Provider) => {
  const name = titleCase(`${p.basic.first_name ?? ''} ${p.basic.last_name ?? ''}`.trim().replace(/\s+/g, ' '));
  const cred = credential(p.basic.credential);
  return cred ? `${name}, ${cred}` : name;
};

export const lastName = (p: Provider) => titleCase((p.basic.last_name ?? '').trim());
export const specialty = (p: Provider) => p.taxonomies.find(t => t.primary)?.desc ?? 'Oncology';
export const compact = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : String(value));

/** NPPES practice location, falling back to the mailing address it also files. */
export const practiceLocation = (p: Provider) =>
  p.addresses.find(a => a.address_purpose === 'LOCATION') ?? p.addresses[0];

/** One-line street address, title-cased out of the registry's upper case. */
export const practiceAddress = (p: Provider) => {
  const a = practiceLocation(p);
  if (!a) return '';
  const street = titleCase(a.address_1 ?? '');
  const city = titleCase(a.city ?? '');
  const zip = (a.postal_code ?? '').slice(0, 5);
  return [street, [city, a.state].filter(Boolean).join(', '), zip].filter(Boolean).join(' · ');
};

/** NPPES files telephone numbers unpunctuated as often as not. */
export const practicePhone = (p: Provider) => {
  const raw = (practiceLocation(p)?.telephone_number ?? '').replace(/\D/g, '');
  if (raw.length !== 10) return practiceLocation(p)?.telephone_number ?? '';
  return `(${raw.slice(0, 3)}) ${raw.slice(3, 6)}-${raw.slice(6)}`;
};
