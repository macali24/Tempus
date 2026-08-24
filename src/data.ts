import type { CrmNote } from './types';

export const simulatedCrm: Record<string, CrmNote> = {
  '1265689889': { objection:'turnaround time', interest:'gastrointestinal oncology and trial matching', note:'Asked whether comprehensive profiling would delay the next treatment decision.', lastContact:'2026-07-28', engagement:88, simulated:true },
  '1033548383': { objection:'tissue requirements', interest:'hematologic malignancies and molecular stratification', note:'Wants clarity on specimen requirements before changing the current workflow.', lastContact:'2026-08-03', engagement:91, simulated:true },
  '1588184956': { objection:'workflow burden', interest:'precision oncology and clinical research', note:'Concerned that ordering and result review could add work for the clinic team.', lastContact:'2026-07-19', engagement:76, simulated:true },
  '1669122206': { objection:'clinical utility', interest:'gastrointestinal malignancies', note:'Asked how broad genomic findings translate into an actionable oncology discussion.', lastContact:'2026-07-11', engagement:69, simulated:true },
  '1114489192': { objection:'evidence quality', interest:'melanoma surveillance and clinical trials', note:'Wants peer-reviewed and regulatory evidence behind product claims.', lastContact:'2026-08-08', engagement:94, simulated:true },
  '1033562327': { objection:'cost and coverage', interest:'hematologic oncology', note:'Asked what can be said accurately about coverage and patient financial responsibility.', lastContact:'2026-06-30', engagement:55, simulated:true },
  '1366670234': { objection:'turnaround time', interest:'solid-tumor profiling', note:'Previous discussion stopped at concerns about receiving results in time for care planning.', lastContact:'2026-07-22', engagement:81, simulated:true },
  '1225567233': { objection:'data integration', interest:'precision medicine workflows', note:'Interested in how genomic results fit into existing clinical review processes.', lastContact:'2026-07-15', engagement:72, simulated:true },
};

export const productEvidence = [
  { id:'xt-scope', topics:['clinical utility','evidence quality','solid tumor','genes'], claim:'xT CDx is an FDA-approved 648-gene tissue-based NGS test for molecular profiling of malignant solid tumors.', source:'Tempus xT CDx product page', url:'https://www.tempus.com/solutions/xt-cdx/', accessed:'2026-08-23' },
  { id:'xt-crc', topics:['clinical utility','colorectal','therapy','evidence quality'], claim:'xT CDx includes companion diagnostic claims for colorectal cancer patients.', source:'Tempus xT CDx product page', url:'https://www.tempus.com/solutions/xt-cdx/', accessed:'2026-08-23' },
  { id:'xt-specimen', topics:['tissue requirements','specimen','workflow burden'], claim:'xT CDx uses DNA isolated from FFPE tumor tissue and matched normal blood or saliva specimens.', source:'Tempus xT CDx technical information', url:'https://www.tempus.com/resources/document-library/tempus-xt-cdx_technical-information/', accessed:'2026-08-23' },
  { id:'xt-limits', topics:['clinical utility','evidence quality'], claim:'Genomic findings outside the labeled companion diagnostic indications are not prescriptive or conclusive for use of a specific therapy.', source:'Tempus xT CDx technical information', url:'https://www.tempus.com/resources/document-library/tempus-xt-cdx_technical-information/', accessed:'2026-08-23' },
] as const;

export function retrieveEvidence(query: string) {
  const tokens = query.toLowerCase().split(/\W+/).filter(token => token.length > 2);
  return productEvidence.map(item => ({ item, score:item.topics.reduce((sum,topic)=>sum+(query.toLowerCase().includes(topic)?4:tokens.some(token=>topic.includes(token))?1:0),0) })).filter(result=>result.score>0).sort((a,b)=>b.score-a.score).map(result=>result.item).slice(0,2);
}
