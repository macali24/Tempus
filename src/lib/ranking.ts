/**
 * Provider ranking.
 *
 * Two deliberate changes from the earlier baseline:
 *
 *  1. `panelFit` is scored and weighted. The case study asks which physicians
 *     see patients who benefit from Tempus's SPECIFIC panels, so raw Medicare
 *     volume alone is the wrong objective; a high-volume benign-haematology
 *     practice is not a solid-tumour profiling opportunity.
 *  2. Identity confidence from the consensus report is an input. A provider we
 *     cannot confidently resolve across sources should not out-rank one we can,
 *     which makes the cross-validator load-bearing rather than decorative.
 */
import { buildConsensus, type ConsensusReport } from './consensus';
import { resolveEntity, type ResolvedEntity } from './entities';
import type { PaymentSummary } from './openpayments';
import { simulatedCrm } from '../data';
import { marketRecord, maxEstimatedPatients, type MarketRecord } from './market';
import type { CmsUtilization, Provider, RankedProvider, Study } from '../types';

export const WEIGHTS = {
  opportunity: 0.32,
  panelFit: 0.17,
  trialSignal: 0.08,
  engagement: 0.13,
  recency: 0.10,
  identity: 0.20,
} as const;

export const WEIGHT_LABEL: Record<keyof typeof WEIGHTS, string> = {
  opportunity: 'Patient opportunity',
  panelFit: 'Panel fit',
  trialSignal: 'Market trial density',
  engagement: 'CRM engagement',
  recency: 'Record freshness',
  identity: 'Identity confidence',
};

const address = (p: Provider) => p.addresses.find(a => a.address_purpose === 'LOCATION') ?? p.addresses[0];

/**
 * Which panel, for how many of this physician's patients.
 *
 * The brief's central question is which doctors see patients who benefit from
 * Tempus's SPECIFIC panels, so this returns an absolute eligible-patient count
 * rather than an affinity score:
 *
 *     estimated patients × indication fit × likelihood of testing
 *
 * Indication fit is read off the vendor tumour mix against what the knowledge
 * base actually claims: xT CDx's labelled intended use is solid malignant
 * neoplasms, with colorectal carrying the KRAS companion-diagnostic indication,
 * so colorectal counts fully, other solid tumours partially, and haematologic
 * volume barely at all. A practice whose tissue is frequently inadequate is
 * routed to xF instead, which is the one thing the xF chunk actually says.
 *
 * Every constant below is a modelled assumption on vendor data, not a measured
 * rate, and is labelled as such in the method panel.
 */
export type PanelFit = {
  /** Modelled patients per year who fit the recommended panel. */
  eligiblePatients: number;
  assay: string;
  rationale: string;
  indicationFit: number;
  testingLikelihood: number;
};

/** Academic centres adopt comprehensive profiling faster; a modelled prior. */
const ADOPTION: Record<string, number> = { Academic: 0.75, Community: 0.55 };

export function panelFit(provider: Provider, market: MarketRecord | undefined, localTrials: Study[]): PanelFit {
  if (!market) {
    // Live NPPES result with no row in the vendor file. Fall back to taxonomy so
    // the provider still ranks, and say plainly that the mix is unknown.
    const { score, assay, rationale } = taxonomyFit(provider, localTrials);
    return { eligiblePatients: 0, assay, rationale: `${rationale} No vendor tumour mix on file.`, indicationFit: score / 100, testingLikelihood: 0 };
  }

  const { colorectal, lung, breast, heme } = market.mix;
  const otherSolid = Math.max(0, 100 - colorectal - lung - breast - heme);
  const solid = colorectal + lung + breast + otherSolid;

  // Colorectal carries the labelled CDx indication, so it is worth full weight;
  // other solid tumours sit inside the intended use but without a CDx claim.
  const indicationFit = (colorectal * 1 + (lung + breast + otherSolid) * 0.6) / 100;

  const trialBump = localTrials.length ? 0.1 : 0;
  const testingLikelihood = Math.min(1, (ADOPTION[market.segment] ?? 0.6) + trialBump);
  const eligiblePatients = Math.round(market.estimatedPatients * indicationFit * testingLikelihood);

  const pct = (n: number) => `${Math.round(n)}%`;

  if (solid < 25) {
    return {
      eligiblePatients, indicationFit, testingLikelihood,
      assay: 'Limited fit',
      rationale: `${pct(heme)} haematologic mix; xT CDx's labelled intended use is solid malignant neoplasms.`,
    };
  }
  if (market.insufficientTissueRate >= 0.3) {
    return {
      eligiblePatients, indicationFit, testingLikelihood,
      assay: 'xF',
      rationale: `${pct(market.insufficientTissueRate * 100)} of cases have inadequate tissue; xF sequences ctDNA from a blood draw when tissue is insufficient.`,
    };
  }
  if (colorectal >= 25) {
    return {
      eligiblePatients, indicationFit, testingLikelihood,
      assay: 'xT CDx',
      rationale: `${pct(colorectal)} colorectal mix matches the KRAS companion-diagnostic indication.`,
    };
  }
  return {
    eligiblePatients, indicationFit, testingLikelihood,
    assay: 'xT CDx',
    rationale: `${pct(solid)} solid-tumour mix sits inside the labelled intended use.`,
  };
}

function taxonomyFit(provider: Provider, localTrials: Study[]): { score: number; assay: string; rationale: string } {
  const taxonomy = (provider.taxonomies.find(t => t.primary)?.desc ?? '').toLowerCase();
  const conditions = localTrials
    .flatMap(t => t.protocolSection.conditionsModule?.conditions ?? [])
    .join(' ')
    .toLowerCase();

  const solidTumor = /oncology|medical oncology|gynecologic|surgical oncology|radiation/.test(taxonomy);
  const heme = /hematology/.test(taxonomy);
  const benignHemeOnly = heme && !/oncology/.test(taxonomy);
  const pediatric = /pediatric/.test(taxonomy);

  if (benignHemeOnly) {
    return { score: 30, assay: 'xT CDx', rationale: 'Primarily benign haematology; solid-tumour profiling fit is limited.' };
  }
  if (pediatric) {
    return { score: 55, assay: 'xT CDx', rationale: 'Paediatric practice; labelled indications are adult solid tumours.' };
  }
  if (solidTumor && heme) {
    const crcSignal = /colorectal|colon|rectal/.test(conditions);
    return {
      score: crcSignal ? 100 : 88,
      assay: 'xT CDx',
      rationale: crcSignal
        ? 'Haematology & oncology practice in a market with active colorectal trials, matching the companion diagnostic indication.'
        : 'Haematology & oncology practice treating solid malignancies.',
    };
  }
  if (solidTumor) {
    return { score: 82, assay: 'xT CDx', rationale: 'Solid-tumour oncology practice.' };
  }
  return { score: 40, assay: 'xT CDx', rationale: 'Specialty is outside the primary solid-tumour profiling population.' };
}

export type RankingInput = {
  providers: Provider[];
  trials: Study[];
  /** True recruiting-trial count for the market, from ClinicalTrials.gov countTotal. */
  trialTotal: number;
  utilization: Record<string, CmsUtilization>;
  payments: Record<string, PaymentSummary>;
};

export type ScoredProvider = RankedProvider & {
  marketTrials: number;
  /** Vendor-modelled annual oncology patients. An estimate, never a count. */
  estimatedPatients?: number;
  /** True when CMS utilization corroborates the vendor estimate. */
  opportunityCorroborated: boolean;
  segment?: string;
  panelFit: number;
  panelAssay: string;
  panelRationale: string;
  /** Modelled patients per year who fit the recommended panel. */
  panelEligiblePatients: number;
  identity: number;
  entity: ResolvedEntity;
  consensus: ConsensusReport;
  payments?: PaymentSummary;
  components: Array<{ key: keyof typeof WEIGHTS; label: string; value: number; weight: number; contribution: number }>;
};

export function rankProviders({ providers, trials, trialTotal, utilization, payments }: RankingInput): ScoredProvider[] {
  const maxBeneficiaries = Math.max(...Object.values(utilization).map(u => u.beneficiaries), 1);

  const cityTrialsFor = (provider: Provider) => {
    const city = address(provider)?.city?.toLowerCase();
    return trials.filter(t =>
      t.protocolSection.contactsLocationsModule?.locations?.some(l => l.city?.toLowerCase() === city),
    );
  };

  // Panel fit is computed for the whole market first so the fit rate can be
  // normalised against the best match actually on the list.
  const fits = new Map<string, PanelFit>(
    providers.map(p => [p.number, panelFit(p, marketRecord(p.number), cityTrialsFor(p))]),
  );
  const maxRate = Math.max(...[...fits.values()].map(f => f.indicationFit * f.testingLikelihood), 0);

  return providers
    .map(provider => {
      const cityTrials = cityTrialsFor(provider);

      const entity = resolveEntity({
        provider,
        utilization: utilization[provider.number],
        payments: payments[provider.number],
        trials,
        publications: [],
      });
      const consensus = buildConsensus(entity);

      const cms = utilization[provider.number];
      const market = marketRecord(provider.number);

      // Opportunity prefers the vendor's patient-population estimate because it
      // is the quantity the brief asks for. CMS is the fallback and, more
      // importantly, the corroboration: a vendor estimate with no Medicare
      // record behind it is scored lower for that reason.
      const fromMarket = market
        ? Math.round((market.estimatedPatients / maxEstimatedPatients) * 100)
        : 0;
      const fromCms = cms ? Math.round((Math.log1p(cms.beneficiaries) / Math.log1p(maxBeneficiaries)) * 100) : 0;
      const corroborated = Boolean(market && cms);
      const opportunity = market
        ? Math.round(fromMarket * (corroborated ? 1 : 0.7))
        : fromCms;

      const fit = fits.get(provider.number)!;
      // Panel fit scores the RATE, not the volume. Patient volume is already the
      // opportunity term; multiplying it in here too would put the same number
      // on both sides of the scale and quietly make the ranking half a headcount
      // sort. So the weight answers "how well does this practice match what we
      // sell?" and opportunity answers "how big is it?". The absolute
      // eligible-patient count is still carried for display, where it is the
      // number a rep actually wants to hear.
      const rate = fit.indicationFit * fit.testingLikelihood;
      const fitScore = maxRate > 0 ? Math.round((rate / maxRate) * 100) : 0;
      // Market-level, so identical for every provider in the same city. Weighted
      // low for that reason and labelled as such in the method panel.
      const trialSignal = Math.min(100, Math.round(Math.log1p(trialTotal) / Math.log1p(800) * 100));
      const crm = simulatedCrm[provider.number];
      const engagement = crm?.engagement ?? 0;

      const updated = provider.basic.last_updated ? new Date(provider.basic.last_updated).getTime() : 0;
      const monthsStale = updated ? (Date.now() - updated) / 2_629_800_000 : 120;
      const recency = Math.max(10, Math.round(100 - monthsStale * 1.5));

      const identity = consensus.confidence;

      const values: Record<keyof typeof WEIGHTS, number> = {
        opportunity, panelFit: fitScore, trialSignal, engagement, recency, identity,
      };
      const components = (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).map(key => ({
        key,
        label: WEIGHT_LABEL[key],
        value: values[key],
        weight: WEIGHTS[key],
        contribution: Math.round(values[key] * WEIGHTS[key] * 10) / 10,
      }));
      const score = Math.round(components.reduce((sum, c) => sum + c.contribution, 0));

      return {
        ...provider,
        score,
        opportunity,
        exactFit: fitScore,
        panelFit: fitScore,
        panelAssay: fit.assay,
        panelRationale: fit.rationale,
        panelEligiblePatients: fit.eligiblePatients,
        trialSignal,
        engagement,
        recency,
        identity,
        confidence: consensus.confidence,
        cityTrials,
        marketTrials: trialTotal,
        estimatedPatients: market?.estimatedPatients,
        opportunityCorroborated: corroborated,
        segment: market?.segment,
        utilization: cms,
        crm,
        entity,
        consensus,
        payments: payments[provider.number],
        components,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Sensitivity analysis: what rank would this provider hold if one signal were
 * unavailable? Answers "what is actually driving this recommendation".
 */
export function rankSensitivity(all: ScoredProvider[], target: ScoredProvider) {
  const baseline = all.findIndex(p => p.number === target.number) + 1;
  return (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).map(key => {
    const reordered = [...all].sort((a, b) => {
      const adjust = (p: ScoredProvider) => p.score - (p.components.find(c => c.key === key)?.contribution ?? 0);
      return adjust(b) - adjust(a);
    });
    const without = reordered.findIndex(p => p.number === target.number) + 1;
    return { key, label: WEIGHT_LABEL[key], baseline, without, delta: without - baseline };
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
