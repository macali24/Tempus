/**
 * Market intelligence: the vendor CSV.
 *
 * Deliberately treated as UNTRUSTED. A rep is handed a third-party panel file;
 * it is often stale, and it is the input most likely to send someone to the
 * wrong building. So it enters the pipeline as one more source to be
 * cross-checked against NPPES and CMS, not as ground truth.
 *
 * `estimatedPatients` is the vendor's model output, not a count. It is the only
 * figure in the system that answers the brief's "likely size of patient
 * population", and it is always labelled as an estimate.
 */
import { GENERATED_MARKET } from './market.generated';
import type { Provider } from '../types';

export type MarketRecord = {
  npi: string;
  physician: string;
  city: string;
  state: string;
  specialty: string;
  estimatedPatients: number;
  segment: string;
  source: string;
  /** Vendor-modelled tumour mix, as a share of annual patients. */
  mix: { colorectal: number; lung: number; breast: number; heme: number };
  /** Vendor-modelled share of cases where FFPE tissue is inadequate. */
  insufficientTissueRate: number;
  /** Vendor-modelled call-planning site. Never a named institution. */
  practiceAddress: string;
  postalCode: string;
};

export const MARKET: MarketRecord[] = GENERATED_MARKET;

const byNpi = new Map(MARKET.map(r => [r.npi, r]));
export const marketRecord = (npi: string) => byNpi.get(npi);

/**
 * The vendor file is a local mock dataset; it has no public URL, and pointing
 * at cms.gov would attribute it to a source it did not come from. In an app
 * whose whole claim is that every figure traces to where it actually came from,
 * a link to the wrong place is worse than no link. The UI omits the link and
 * shows the file's own `source` column instead.
 */
export const MARKET_SOURCE_URL = undefined;

/** Largest estimate in the file, used to normalise opportunity within a market. */
export const maxEstimatedPatients = Math.max(...MARKET.map(r => r.estimatedPatients), 1);

/** NPPES taxonomy code for Hematology & Oncology, so demo rows grade like live ones. */
const HEME_ONC = '207RH0003X';

/**
 * The CSV standing on its own.
 *
 * The brief's required output is a ranked provider list built from the ingested
 * market file; that must not be hostage to a third-party API being reachable.
 * These records carry no `last_updated`, so freshness scores at its floor and
 * identity confidence stays low: demo mode is visibly weaker than live mode
 * rather than silently pretending to be it.
 */
export function marketProviders(city: string, state: string): Provider[] {
  const wantedCity = city.trim().toLowerCase();
  const wantedState = state.trim().toUpperCase();
  return MARKET
    .filter(r => r.city.toLowerCase() === wantedCity && r.state.toUpperCase() === wantedState)
    .map(r => {
      const parts = r.physician.trim().split(/\s+/);
      return {
        number: r.npi,
        basic: {
          first_name: parts.slice(0, -1).join(' '),
          last_name: parts[parts.length - 1] ?? '',
          credential: 'MD',
          status: 'A',
        },
        addresses: [{
          address_purpose: 'LOCATION',
          address_1: r.practiceAddress,
          city: r.city,
          state: r.state,
          postal_code: r.postalCode,
        }],
        taxonomies: [{ code: HEME_ONC, desc: r.specialty, primary: true }],
      };
    });
}

/** Cities the ingested CSV can serve without any network call. */
export const demoMarkets = [...new Set(MARKET.map(r => `${r.city}, ${r.state}`))];
