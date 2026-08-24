import type { RankedProvider } from './types';

export type OutcomeFeedback = { npi:string; features:number[]; label:0|1; timestamp:string; source:'user' };
export type ModelInsight = { probability:number; confidence:'low'|'medium'|'high'; contributions:Array<{label:string;value:number}>; realOutcomes:number; bootstrapOutcomes:number; accuracy:number; brier:number };

const STORAGE_KEY='tempus-outcome-feedback-v1';
const labels=['Opportunity','Trial activity','Engagement','Freshness','Evidence quality'];
const bootstrap:Array<{features:number[];label:0|1}>=[
  {features:[.91,.72,.88,.84,.95],label:1},{features:[.76,.65,.82,.77,.90],label:1},{features:[.82,.28,.74,.91,.88],label:1},
  {features:[.63,.81,.70,.68,.92],label:1},{features:[.70,.54,.91,.62,.86],label:1},{features:[.58,.70,.65,.80,.82],label:1},
  {features:[.22,.18,.20,.72,.48],label:0},{features:[.35,.12,.30,.42,.55],label:0},{features:[.44,.30,.15,.38,.62],label:0},
  {features:[.18,.60,.10,.45,.45],label:0},{features:[.52,.20,.25,.31,.58],label:0},{features:[.30,.38,.40,.52,.50],label:0},
];

const sigmoid=(value:number)=>1/(1+Math.exp(-Math.max(-20,Math.min(20,value))));
export const providerFeatures=(p:RankedProvider)=>[p.opportunity,p.trialSignal,p.engagement,p.recency,p.confidence].map(value=>value/100);

export function loadFeedback():OutcomeFeedback[]{try{return JSON.parse(localStorage.getItem(STORAGE_KEY)??'[]')}catch{return[]}}
export function recordFeedback(provider:RankedProvider,label:0|1){const current=loadFeedback();current.push({npi:provider.number,features:providerFeatures(provider),label,timestamp:new Date().toISOString(),source:'user'});localStorage.setItem(STORAGE_KEY,JSON.stringify(current.slice(-100)))}

export function trainShadowModel(provider:RankedProvider):ModelInsight{
  const real=loadFeedback();const samples=[...bootstrap,...real];let weights=[0,0,0,0,0];let bias=0;const rate=.08;
  for(let epoch=0;epoch<700;epoch++){let gradients=[0,0,0,0,0],biasGradient=0;samples.forEach(sample=>{const prediction=sigmoid(bias+weights.reduce((sum,w,index)=>sum+w*sample.features[index],0));const error=prediction-sample.label;gradients=gradients.map((g,index)=>g+error*sample.features[index]);biasGradient+=error});weights=weights.map((weight,index)=>weight-rate*(gradients[index]/samples.length+.015*weight));bias-=rate*biasGradient/samples.length}
  const features=providerFeatures(provider);const probability=sigmoid(bias+weights.reduce((sum,w,index)=>sum+w*features[index],0));
  const predictions=samples.map(sample=>sigmoid(bias+weights.reduce((sum,w,index)=>sum+w*sample.features[index],0)));const accuracy=predictions.filter((prediction,index)=>(prediction>=.5?1:0)===samples[index].label).length/samples.length;const brier=predictions.reduce((sum,prediction,index)=>sum+(prediction-samples[index].label)**2,0)/samples.length;
  const confidence=real.length>=40?'high':real.length>=15?'medium':'low';const contributions=weights.map((weight,index)=>({label:labels[index],value:Math.round(weight*features[index]*100)/100})).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value));
  return {probability:Math.round(probability*100),confidence,contributions,realOutcomes:real.length,bootstrapOutcomes:bootstrap.length,accuracy:Math.round(accuracy*100),brier:Math.round(brier*100)/100};
}

export function nextBestAction(provider:RankedProvider){if(!provider.crm)return 'Capture a real discovery note before recommending outreach.';if(provider.confidence<70)return 'Verify missing evidence before contacting this provider.';if(/turnaround|cost|coverage/i.test(provider.crm.objection))return 'Ask a discovery question; the current knowledge base does not support a numerical response.';if(provider.cityTrials.length>0)return 'Lead with the market’s active research signal, then validate whether it affects this provider’s workflow.';return 'Use a short discovery call to validate need before presenting product capabilities.'}

export const isSlackEligible=(provider:RankedProvider,rankPosition:number,scoreDelta:number)=>rankPosition<=5&&provider.score>=70&&scoreDelta>=10&&provider.confidence>=70&&provider.cityTrials.length>0;
