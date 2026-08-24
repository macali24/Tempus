export type Provider = {
  number: string;
  basic: { first_name?: string; last_name?: string; credential?: string; last_updated?: string; status?: string };
  addresses: Array<{ address_purpose: string; address_1: string; city: string; state: string; postal_code: string; telephone_number?: string }>;
  taxonomies: Array<{ code: string; desc: string; primary: boolean }>;
};

export type Study = {
  protocolSection: {
    identificationModule: { nctId: string; briefTitle: string };
    statusModule: { overallStatus: string };
    conditionsModule?: { conditions?: string[] };
    contactsLocationsModule?: { locations?: Array<{ facility?: string; city?: string; state?: string }> };
  };
};

export type RankedProvider = Provider & { score: number; exactFit: number; trialSignal: number; recency: number; cityTrials: Study[] };

export type ProviderPoint = { npi: string; longitude: number; latitude: number };
export type ProviderPhoto = { url: string; sourceUrl: string };
