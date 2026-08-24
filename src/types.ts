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

export type CmsUtilization = { beneficiaries: number; services: number; hcpcsCodes: number; medicarePayment: number; year: number; sourceUrl: string };
export type CrmNote = { objection: string; interest: string; note: string; lastContact: string; engagement: number; simulated: true };
export type Publication = { pmid: string; title: string; date?: string; sourceUrl: string };
export type RankedProvider = Provider & { score: number; opportunity: number; exactFit: number; trialSignal: number; engagement: number; recency: number; confidence: number; cityTrials: Study[]; utilization?: CmsUtilization; crm?: CrmNote };

export type ProviderPoint = { npi: string; longitude: number; latitude: number };
export type ProviderPhoto = { url: string; sourceUrl: string };
