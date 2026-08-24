import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const PptxGenJS = require('/private/tmp/tempus-slide-tools/node_modules/pptxgenjs');

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'Tempus Sales Copilot case-study team';
pptx.company = 'Case-study prototype';
pptx.subject = 'Five-slide Tempus Sales Copilot case study';
pptx.title = 'Tempus Sales Copilot: From territory data to the next best conversation';
pptx.lang = 'en-US';
pptx.theme = {
  headFontFace: 'Arial',
  bodyFontFace: 'Arial',
  lang: 'en-US',
};
pptx.defineLayout({ name: 'TEMPUS_WIDE', width: 13.333, height: 7.5 });
pptx.layout = 'TEMPUS_WIDE';

const W = 13.333;
const H = 7.5;
const FONT = 'Arial';
const C = {
  ink: '111827',
  ink2: '334155',
  muted: '64748B',
  faint: '94A3B8',
  line: 'DCE3ED',
  canvas: 'F7F8FB',
  white: 'FFFFFF',
  blue: '4F67F6',
  blue2: '3157F6',
  bluePale: 'EEF1FF',
  teal: '14846F',
  tealPale: 'E8F5F1',
  amber: 'A86B00',
  amberPale: 'FFF5DE',
  red: 'B94A48',
  navy: '101625',
};

const assets = resolve('deliverables/assets');
const territoryMap = resolve(assets, 'territory_map.png');
const profileWorkflow = resolve(assets, 'profile_workflow.png');
const rankingTable = resolve(assets, 'ranking_table.png');
const trustStrip = resolve(assets, 'trust_strip.png');

function addText(slide, text, x, y, w, h, opts = {}) {
  slide.addText(text, {
    x, y, w, h,
    fontFace: FONT,
    fontSize: opts.fontSize ?? 16,
    color: opts.color ?? C.ink,
    bold: opts.bold ?? false,
    margin: opts.margin ?? 0,
    breakLine: false,
    valign: opts.valign ?? 'mid',
    align: opts.align ?? 'left',
    fit: 'shrink',
    paraSpaceAfterPt: opts.paraSpaceAfterPt ?? 0,
    lineSpacingMultiple: opts.lineSpacingMultiple,
    isTextBox: true,
    ...opts,
  });
}

function addKicker(slide, text, x = 0.68, y = 0.33, color = C.blue2) {
  addText(slide, text.toUpperCase(), x, y, 5.6, 0.24, {
    fontSize: 9.5,
    color,
    bold: true,
    charSpacing: 1.8,
  });
}

function addTitle(slide, title, subtitle, opts = {}) {
  addKicker(slide, opts.kicker ?? 'TEMPUS SALES COPILOT · CASE STUDY');
  addText(slide, title, 0.68, 0.62, opts.titleW ?? 12.0, opts.titleH ?? 0.55, {
    fontSize: opts.titleSize ?? 27,
    color: C.ink,
    bold: true,
    valign: 'top',
  });
  if (subtitle) {
    addText(slide, subtitle, 0.68, 1.16, opts.subtitleW ?? 12.0, 0.36, {
      fontSize: opts.subtitleSize ?? 13.5,
      color: C.muted,
      valign: 'top',
    });
  }
}

function addFooter(slide, n, text = 'Composite case-study prototype · simulated CRM/vendor inputs · no physician endorsement implied') {
  slide.addShape(pptx.ShapeType.line, {
    x: 0.68, y: 7.17, w: 11.97, h: 0,
    line: { color: C.line, width: 0.6 },
  });
  addText(slide, text, 0.68, 7.21, 10.9, 0.16, {
    fontSize: 7.8,
    color: C.faint,
    valign: 'top',
  });
  addText(slide, String(n).padStart(2, '0'), 12.15, 7.19, 0.5, 0.18, {
    fontSize: 8.5,
    color: C.faint,
    bold: true,
    align: 'right',
    valign: 'top',
  });
}

function addChip(slide, text, x, y, w, opts = {}) {
  const fill = opts.fill ?? C.bluePale;
  const color = opts.color ?? C.blue2;
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h: opts.h ?? 0.33,
    rectRadius: 0.08,
    fill: { color: fill, transparency: opts.transparency ?? 0 },
    line: { color: opts.line ?? fill, width: 0.5 },
  });
  addText(slide, text, x + 0.1, y + 0.01, w - 0.2, (opts.h ?? 0.33) - 0.02, {
    fontSize: opts.fontSize ?? 9.2,
    color,
    bold: opts.bold ?? true,
    align: opts.align ?? 'center',
  });
}

function addCard(slide, x, y, w, h, opts = {}) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h,
    rectRadius: 0.08,
    fill: { color: opts.fill ?? C.white, transparency: opts.transparency ?? 0 },
    line: { color: opts.line ?? C.line, width: opts.lineWidth ?? 0.7 },
    shadow: opts.shadow === false ? undefined : {
      type: 'outer', color: '000000', opacity: 0.08, blur: 1.2, offset: 0.5, angle: 45,
    },
  });
}

function addScreenshot(slide, path, x, y, w, h, altText) {
  addCard(slide, x - 0.04, y - 0.04, w + 0.08, h + 0.08, { shadow: true });
  slide.addImage({
    path, x, y, w, h,
    sizing: { type: 'cover', w, h },
    altText,
  });
}

function addNumberedStep(slide, n, title, body, x, y, w, accent = C.blue2) {
  slide.addShape(pptx.ShapeType.ellipse, {
    x, y, w: 0.38, h: 0.38,
    fill: { color: accent },
    line: { color: accent },
  });
  addText(slide, String(n), x, y + 0.01, 0.38, 0.34, {
    fontSize: 11.5,
    color: C.white,
    bold: true,
    align: 'center',
  });
  addText(slide, title.toUpperCase(), x + 0.55, y - 0.01, w - 0.55, 0.24, {
    fontSize: 10.2,
    color: accent,
    bold: true,
    charSpacing: 1.1,
    valign: 'top',
  });
  addText(slide, body, x + 0.55, y + 0.25, w - 0.55, 0.53, {
    fontSize: 14.2,
    color: C.ink2,
    valign: 'top',
  });
}

function addPipelineCard(slide, n, title, body, x, y, w, color) {
  addCard(slide, x, y, w, 2.03, { shadow: false, line: C.line });
  addChip(slide, `0${n}`, x + 0.18, y + 0.18, 0.52, { fill: color, color: C.white, line: color, h: 0.29, fontSize: 8.6 });
  addText(slide, title, x + 0.18, y + 0.61, w - 0.36, 0.35, {
    fontSize: 14.5,
    color: C.ink,
    bold: true,
    valign: 'top',
  });
  addText(slide, body, x + 0.18, y + 1.02, w - 0.36, 0.75, {
    fontSize: 10.5,
    color: C.muted,
    valign: 'top',
    breakLine: false,
  });
}

// --------------------------------------------------------------------- Slide 1
{
  const slide = pptx.addSlide();
  slide.background = { color: C.canvas };
  slide.addImage({
    path: territoryMap, x: 0, y: 0, w: W, h: H,
    sizing: { type: 'cover', w: W, h: H },
    altText: 'Chicago territory map with a 60-provider working set and ranked priority queue.',
  });

  // Use the empty lake area as the narrative surface while preserving the product UI.
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 7.05, y: 0.65, w: 5.55, h: 5.92,
    rectRadius: 0.08,
    fill: { color: C.white, transparency: 4 },
    line: { color: C.white, transparency: 100 },
    shadow: { type: 'outer', color: '000000', opacity: 0.12, blur: 1.8, offset: 0.7, angle: 45 },
  });
  addChip(slide, 'CASE-STUDY PROTOTYPE', 7.48, 1.08, 1.72, { fill: C.bluePale, color: C.blue2, fontSize: 8.8 });
  addText(slide, 'From scattered signals\nto the next best\nconversation', 7.47, 1.62, 4.62, 1.83, {
    fontSize: 29,
    color: C.ink,
    bold: true,
    valign: 'top',
    breakLine: false,
    lineSpacingMultiple: 0.9,
  });
  addText(slide, 'A verifier-first sales copilot for deciding who to call, why now, and what can be said credibly.', 7.5, 3.68, 4.48, 0.73, {
    fontSize: 15,
    color: C.ink2,
    valign: 'top',
  });

  const questions = [
    ['01', 'WHO TO CALL', 'Prioritize impact'],
    ['02', 'WHY NOW', 'Surface dated signals'],
    ['03', 'WHAT TO SAY', 'Prepare grounded copy'],
  ];
  questions.forEach(([n, q, a], i) => {
    const x = 7.48 + i * 1.58;
    addText(slide, n, x, 4.72, 0.36, 0.22, { fontSize: 9, color: C.blue2, bold: true, valign: 'top' });
    addText(slide, q, x, 5.01, 1.42, 0.25, { fontSize: 9.3, color: C.ink, bold: true, valign: 'top' });
    addText(slide, a, x, 5.3, 1.42, 0.34, { fontSize: 9.5, color: C.muted, valign: 'top' });
  });
  addText(slide, 'Scope: sales preparation, not clinical decision support or physician-quality scoring.', 7.5, 6.03, 4.65, 0.27, {
    fontSize: 8.6,
    color: C.muted,
    italic: true,
    valign: 'top',
  });
  addText(slide, 'Composite demo · 60-provider working set · simulated commercial inputs', 0.55, 7.12, 7.2, 0.18, {
    fontSize: 7.6,
    color: C.ink2,
    bold: true,
    valign: 'top',
  });
  addText(slide, '01', 12.2, 7.1, 0.5, 0.2, { fontSize: 8.5, color: C.ink2, bold: true, align: 'right', valign: 'top' });
  slide.addNotes(`The problem I chose to solve is the last mile between having data and taking action. A rep covering a territory like Chicago may have hundreds of possible physicians, but useful information is split across CRM notes, market estimates, provider records, trial activity, and product evidence. Before a short meeting, the rep still has to determine who matters most, why the timing is relevant, and what can be said credibly. This is a sales-preparation problem, not a clinical recommendation or physician-quality system.`);
}

// --------------------------------------------------------------------- Slide 2
{
  const slide = pptx.addSlide();
  slide.background = { color: C.canvas };
  addTitle(slide, 'One workflow. Three answers.', 'The copilot converts a territory into a call-ready, evidence-backed conversation.', {
    titleW: 5.05,
    subtitleW: 5.05,
  });

  addNumberedStep(slide, 1, 'Prioritize', 'Rank providers and accounts by potential impact and evidence confidence.', 0.72, 1.77, 4.85, C.blue2);
  addNumberedStep(slide, 2, 'Explain', 'Show why now, panel fit, and any identity field that needs verification.', 0.72, 2.85, 4.85, C.teal);
  addNumberedStep(slide, 3, 'Prepare', 'Draft a 30-second opener and response to the known concern.', 0.72, 3.93, 4.85, C.amber);

  addCard(slide, 0.72, 5.23, 4.77, 1.1, { fill: C.amberPale, line: 'F0D79B', shadow: false });
  addChip(slide, 'VERIFY', 0.92, 5.48, 0.82, { fill: C.amber, color: C.white, line: C.amber, h: 0.29, fontSize: 8.4 });
  addText(slide, 'Uncertainty remains visible before outreach; the tool accelerates judgment rather than replacing it.', 1.92, 5.39, 3.25, 0.58, {
    fontSize: 11.2,
    color: '6F4A05',
    valign: 'top',
  });

  addScreenshot(slide, profileWorkflow, 6.05, 1.22, 6.62, 5.84, 'Provider dossier showing priority, why-now signals, a 30-second opener, and a simulated objection.');
  addChip(slide, 'AI-DRAFTED · EVIDENCE-LINKED · REP-REVIEWED', 8.08, 6.55, 3.95, {
    fill: C.navy, color: C.white, line: C.navy, h: 0.34, fontSize: 8.4,
  });
  addFooter(slide, 2);
  slide.addNotes(`I translated the brief into one rep workflow. First, the system prioritizes whom to call. Selecting a physician then reveals why the opportunity is timely, which panel appears most relevant for sales planning, and any concern from the simulated CRM. Finally, it prepares a short opener and objection response using cited product evidence. The rep can still see uncertainty and contested fields, so the tool accelerates judgment rather than hiding or replacing it.`);
}

// --------------------------------------------------------------------- Slide 3
{
  const slide = pptx.addSlide();
  slide.background = { color: C.canvas };
  addTitle(slide, 'A verifier-first build: decisions stay deterministic.', 'The process starts with the rep’s decision, not with a model.');
  addChip(slide, 'GENAI WRITES THE MESSAGE · IT DOES NOT GENERATE THE RANK', 8.02, 0.38, 4.62, {
    fill: C.navy, color: C.white, line: C.navy, h: 0.36, fontSize: 8.5,
  });

  const xs = [0.68, 3.7, 6.72, 9.74];
  addPipelineCard(slide, 1, 'Ingest + label', 'CSV market estimates, CRM text, and Markdown product KB. Public enrichment from NPPES, CMS, trials, payments, and PubMed.', xs[0], 1.67, 2.55, C.blue2);
  addPipelineCard(slide, 2, 'Resolve + score', 'NPI and name joins, cross-source consensus, deterministic weighted ranking, and rule-based panel fit.', xs[1], 1.67, 2.55, C.teal);
  addPipelineCard(slide, 3, 'Retrieve + draft', 'BM25 + curated topics retrieve evidence. Gemini returns structured claims with evidence IDs.', xs[2], 1.67, 2.55, '6C63FF');
  addPipelineCard(slide, 4, 'Verify + assemble', 'Input screen → evidence grade → numeric guard → independent Llama entailment → rep review.', xs[3], 1.67, 2.55, C.amber);
  [3.33, 6.35, 9.37].forEach(x => {
    slide.addShape(pptx.ShapeType.chevron, {
      x, y: 2.45, w: 0.25, h: 0.42,
      fill: { color: 'C7CFDD' },
      line: { color: 'C7CFDD' },
    });
  });

  addCard(slide, 0.68, 4.18, 5.72, 2.45, { shadow: false, fill: C.white });
  addKicker(slide, 'BUILD PROCESS + TOOLS', 0.92, 4.45, C.teal);
  const process = [
    ['1', 'Frame the rep decision'],
    ['2', 'Join + normalize sources'],
    ['3', 'Prototype the workflow'],
    ['4', 'Attack failure modes + refine'],
  ];
  process.forEach(([n, text], i) => {
    const y = 4.89 + i * 0.36;
    addText(slide, n, 0.95, y, 0.25, 0.22, { fontSize: 9.2, color: C.teal, bold: true, valign: 'top' });
    addText(slide, text, 1.28, y - 0.02, 2.45, 0.25, { fontSize: 10.4, color: C.ink2, valign: 'top' });
  });
  addChip(slide, 'Claude Opus 5 · build-time', 3.83, 4.83, 2.17, { fill: C.bluePale, color: C.blue2, h: 0.3, fontSize: 8.2 });
  addChip(slide, 'React · TypeScript · Vite', 3.83, 5.25, 2.17, { fill: 'EEF4F8', color: C.ink2, h: 0.3, fontSize: 8.2 });
  addChip(slide, 'Gemini + Groq · runtime', 3.83, 5.67, 2.17, { fill: C.tealPale, color: C.teal, h: 0.3, fontSize: 8.2 });
  addChip(slide, 'No-key deterministic fallback', 3.83, 6.09, 2.17, { fill: C.amberPale, color: C.amber, h: 0.3, fontSize: 8.2 });

  addCard(slide, 6.63, 4.18, 6.03, 2.45, { shadow: false, fill: C.navy, line: C.navy });
  addKicker(slide, 'DRAFT PROMPT EXCERPT', 6.94, 4.45, '8EA1FF');
  addText(slide, '“Use only supplied EVIDENCE.\nEvery claim cites evidenceIds.\nNever state a number absent from cited evidence.\nRespond only with JSON.”', 6.94, 4.83, 5.08, 1.18, {
    fontSize: 13,
    color: C.white,
    bold: false,
    valign: 'top',
    breakLine: false,
    lineSpacingMultiple: 1.05,
  });
  addText(slide, 'Model choice: free-tier availability, speed, and provider independence, not a claim that these models are universally best.', 6.94, 6.08, 5.1, 0.31, {
    fontSize: 8.4,
    color: 'B8C1D8',
    italic: true,
    valign: 'top',
  });
  addFooter(slide, 3, 'Required sources: CSV + CRM text + Markdown KB · public enrichment is best-effort · model keys optional');
  slide.addNotes(`My process began by framing the rep’s decisions: identify, prioritize, explain, and prepare. I then ingested the three required formats, added public enrichment, resolved physician identities, and built a transparent score before adding generation. Claude Opus 5 supported development; React, TypeScript, and Vite power the prototype. At runtime, Gemini drafts structured claims and Llama through Groq can check semantic support. I chose them for free-tier access, speed, and provider independence, not because I ran a benchmark proving they were best. The four gates and deterministic fallback keep model authority narrow.`);
}

// --------------------------------------------------------------------- Slide 4
{
  const slide = pptx.addSlide();
  slide.background = { color: C.canvas };
  addTitle(slide, 'An explainable score, not an AI hunch.', 'Priority is a transparent 0–100 index; it is not a conversion probability or clinical-quality score.');

  addKicker(slide, 'WHAT THE REP SEES', 0.68, 1.62, C.muted);
  addScreenshot(slide, rankingTable, 0.68, 1.98, 8.25, 3.47, 'Ranked doctor comparison table showing priority, opportunity, weighted drivers, patient estimates, public CMS context, and panel recommendation.');
  addChip(slide, 'MODELED', 0.83, 5.72, 0.88, { fill: C.tealPale, color: C.teal, h: 0.28, fontSize: 7.9 });
  addText(slide, 'patient estimates + tumour mix', 1.82, 5.72, 1.72, 0.24, { fontSize: 8.5, color: C.muted, valign: 'top' });
  addChip(slide, 'PUBLIC', 3.67, 5.72, 0.78, { fill: C.bluePale, color: C.blue2, h: 0.28, fontSize: 7.9 });
  addText(slide, 'NPPES · CMS · trials', 4.55, 5.72, 1.4, 0.24, { fontSize: 8.5, color: C.muted, valign: 'top' });
  addChip(slide, 'SIMULATED', 6.1, 5.72, 1.02, { fill: C.amberPale, color: C.amber, h: 0.28, fontSize: 7.9 });
  addText(slide, 'CRM notes', 7.23, 5.72, 0.82, 0.24, { fontSize: 8.5, color: C.muted, valign: 'top' });

  addCard(slide, 9.22, 1.58, 3.43, 4.9, { shadow: false, fill: C.white });
  addKicker(slide, 'V1 POLICY WEIGHTS', 9.52, 1.89, C.blue2);
  const weights = [
    ['Opportunity', 32, C.blue2],
    ['Identity', 20, C.teal],
    ['Panel fit', 17, '6C63FF'],
    ['Engagement', 13, C.amber],
    ['Freshness', 10, '64748B'],
    ['Trials', 8, '94A3B8'],
  ];
  weights.forEach(([label, value, color], i) => {
    const y = 2.35 + i * 0.48;
    addText(slide, String(value), 9.5, y, 0.43, 0.25, { fontSize: 13, color, bold: true, align: 'right', valign: 'top' });
    addText(slide, label, 10.08, y, 1.03, 0.25, { fontSize: 10.2, color: C.ink2, valign: 'top' });
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 11.1, y: y + 0.04, w: 1.18, h: 0.11,
      rectRadius: 0.05,
      fill: { color: 'E8ECF3' }, line: { color: 'E8ECF3' },
    });
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 11.1, y: y + 0.04, w: 1.18 * (Number(value) / 32), h: 0.11,
      rectRadius: 0.05,
      fill: { color }, line: { color },
    });
  });
  slide.addShape(pptx.ShapeType.line, { x: 9.52, y: 5.35, w: 2.83, h: 0, line: { color: C.line, width: 0.6 } });
  addText(slide, '49%', 9.5, 5.57, 0.55, 0.3, { fontSize: 17, color: C.blue2, bold: true, valign: 'top' });
  addText(slide, 'impact + fit', 10.12, 5.6, 0.9, 0.24, { fontSize: 9.1, color: C.muted, valign: 'top' });
  addText(slide, '30%', 11.1, 5.57, 0.55, 0.3, { fontSize: 17, color: C.teal, bold: true, valign: 'top' });
  addText(slide, 'trust', 11.72, 5.6, 0.5, 0.24, { fontSize: 9.1, color: C.muted, valign: 'top' });
  addText(slide, '21% timing', 9.52, 6.0, 1.08, 0.23, { fontSize: 9.4, color: C.amber, bold: true, valign: 'top' });
  addText(slide, 'Hand-set and tunable because no historical conversion labels were available.', 10.63, 5.98, 1.62, 0.35, { fontSize: 8.2, color: C.muted, italic: true, valign: 'top' });
  addFooter(slide, 4, 'Priority 83 ≠ 83% likelihood · “fit 100” is relative within the loaded cohort · missing signals are not imputed');
  slide.addNotes(`I used a transparent formula because there was no historical outcome data with which to train a reliable predictive model. Opportunity estimates potential patient impact; panel fit connects that opportunity to a Tempus use case; identity and freshness reduce the risk of acting on the wrong or outdated record; engagement and trials represent timing. The exact weights are explicit v1 policy choices, not learned coefficients. The interface shows the raw signals and top weighted drivers, so a rep can understand why someone ranked highly.`);
}

// --------------------------------------------------------------------- Slide 5
{
  const slide = pptx.addSlide();
  slide.background = { color: C.canvas };
  addTitle(slide, 'Designed to show uncertainty, not hide it.', 'The prototype validates control and traceability; commercial lift still requires a real-world pilot.');
  addScreenshot(slide, trustStrip, 0.68, 1.46, 11.98, 3.16, 'Provider identity and trust strip showing a priority score, verify-before-calling warning, identity confidence, contested fields, verified claims, cited sources, modelled patient estimate, and panel fit.');

  const cols = [0.68, 4.73, 8.78];
  const cardW = 3.88;
  const cardY = 4.89;
  const cardH = 1.72;
  [
    { title: 'PROVEN TODAY', color: C.teal, fill: C.tealPale, stat: '101 / 101', body: 'Golden cases passed\n8 / 8 gate-wiring assertions\n0 model calls from poisoned CRM' },
    { title: 'ASSUMPTIONS', color: C.amber, fill: C.amberPale, stat: 'V1', body: 'Simulated CRM + vendor estimates\nHeuristic weights and fit rules\nPublic-data coverage is incomplete' },
    { title: 'NEXT PILOT', color: C.blue2, fill: C.bluePale, stat: 'REAL DATA', body: 'Connect Salesforce\nCalibrate weights from outcomes\nMeasure prep time, usefulness, precision@5' },
  ].forEach((item, i) => {
    addCard(slide, cols[i], cardY, cardW, cardH, { shadow: false, fill: C.white });
    addChip(slide, item.title, cols[i] + 0.2, cardY + 0.18, 1.27, { fill: item.fill, color: item.color, line: item.fill, h: 0.28, fontSize: 8.0 });
    addText(slide, item.stat, cols[i] + 2.1, cardY + 0.17, 1.5, 0.32, { fontSize: 16, color: item.color, bold: true, align: 'right', valign: 'top' });
    addText(slide, item.body, cols[i] + 0.23, cardY + 0.68, 3.34, 0.78, { fontSize: 10.4, color: C.ink2, valign: 'top', breakLine: false, lineSpacingMultiple: 0.95 });
  });

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.68, y: 6.76, w: 11.98, h: 0.31,
    rectRadius: 0.05,
    fill: { color: C.navy }, line: { color: C.navy },
  });
  addText(slide, 'PROTOTYPE ACCESS', 0.9, 6.78, 1.18, 0.21, { fontSize: 8.2, color: '9FAEFF', bold: true, valign: 'top' });
  addText(slide, 'npm install  →  npm run dev  →  localhost:5173', 2.2, 6.77, 4.0, 0.22, { fontSize: 9.5, color: C.white, bold: true, valign: 'top' });
  addText(slide, 'No model keys required · deterministic fallback included', 7.7, 6.78, 4.65, 0.21, { fontSize: 8.4, color: 'D7DDED', align: 'right', valign: 'top' });
  addFooter(slide, 5, 'Test results validate pipeline behavior, not 100% AI accuracy · human review remains required');
  slide.addNotes(`I refined the prototype through executable golden cases, adversarial CRM fixtures, missing-data behavior, pagination checks, and cross-source contradictions. The current individual suites pass 101 of 101 golden cases, all eight cross-model wiring assertions, and block both hostile CRM fixtures before any model call. Those results validate pipeline behavior, not commercial prediction or 100 percent model accuracy. The key assumptions remain simulated commercial data, heuristic weights, and incomplete public datasets. The next step is a controlled pilot with real Salesforce data and measures such as preparation time, rep usefulness, edits, and precision at the top of the queue.`);
}

const out = resolve('deliverables/Tempus_Sales_Copilot_5_Slide_Case_Study.pptx');
await pptx.writeFile({ fileName: out, compression: true });
console.log(out);
