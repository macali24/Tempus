/**
 * Hybrid retrieval over the product knowledge base.
 *
 * Two independent channels are scored and fused with Reciprocal Rank Fusion:
 *
 *   1. BM25: Okapi BM25 over stemmed tokens. Catches exact identifiers that
 *      dense retrieval reliably misses: gene counts, assay names, "FFPE", "MSI".
 *   2. Topical: overlap against curated topic labels, which encodes the
 *      objection vocabulary reps actually use ("tissue requirements") and maps
 *      it onto document language ("specimen", "FFPE").
 *
 * RRF is used rather than score interpolation because the two channels are on
 * incomparable scales; rank fusion needs no per-channel normalisation.
 *
 * An embedding channel plugs in at `fuse()` without touching callers.
 */
import { KB, type KbChunk } from './kb';

const STOP = new Set(['the','a','an','and','or','of','for','to','in','on','is','are','was','were','be','with','that','this','it','as','at','by','from','how','what','can','do','does','about','their','they','we','our','you','your','i']);

/** Light suffix stripping, enough to bridge require/requirements, gene/genes. */
function stem(token: string): string {
  return token
    .replace(/(ements|ations|ement|ation|ings|ness)$/, '')
    .replace(/(ies)$/, 'y')
    .replace(/(es|s)$/, '')
    .replace(/(ed|ing)$/, '');
}

export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2 && !STOP.has(t)).map(stem);
}

type Indexed = { chunk: KbChunk; tokens: string[]; length: number };

const index: Indexed[] = KB.map(chunk => {
  const tokens = tokenize(`${chunk.text} ${chunk.section} ${chunk.assay}`);
  return { chunk, tokens, length: tokens.length };
});
const avgLength = index.reduce((sum, d) => sum + d.length, 0) / (index.length || 1);

const docFreq = new Map<string, number>();
index.forEach(d => new Set(d.tokens).forEach(t => docFreq.set(t, (docFreq.get(t) ?? 0) + 1)));

const K1 = 1.5;
const B = 0.75;

function bm25(queryTokens: string[]): Array<{ id: string; score: number }> {
  const N = index.length;
  return index.map(doc => {
    let score = 0;
    for (const term of new Set(queryTokens)) {
      const tf = doc.tokens.filter(t => t === term).length;
      if (!tf) continue;
      const df = docFreq.get(term) ?? 0;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      score += idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (doc.length / avgLength)));
    }
    return { id: doc.chunk.id, score };
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score);
}

function topical(query: string, queryTokens: string[]): Array<{ id: string; score: number }> {
  const lower = query.toLowerCase();
  return KB.map(chunk => {
    let score = 0;
    for (const topic of chunk.topics) {
      if (lower.includes(topic)) score += 4;                                  // exact phrase
      else if (queryTokens.some(t => tokenize(topic).includes(t))) score += 1; // shared stem
    }
    return { id: chunk.id, score };
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score);
}

/** Reciprocal Rank Fusion. k=60 is the standard damping constant. */
function fuse(channels: Array<Array<{ id: string; score: number }>>, k = 60): string[] {
  const fused = new Map<string, number>();
  for (const ranking of channels) {
    ranking.forEach((entry, position) => {
      fused.set(entry.id, (fused.get(entry.id) ?? 0) + 1 / (k + position + 1));
    });
  }
  return [...fused.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

export type RetrievalResult = {
  chunks: KbChunk[];
  /** Per-channel diagnostics, surfaced in the UI so retrieval is inspectable. */
  channels: { bm25: string[]; topical: string[] };
};

export function retrieve(query: string, limit = 3): RetrievalResult {
  const queryTokens = tokenize(query);
  const lexical = bm25(queryTokens);
  const topics = topical(query, queryTokens);
  const order = fuse([lexical, topics]).slice(0, limit);
  const byId = new Map(KB.map(c => [c.id, c]));
  return {
    chunks: order.map(id => byId.get(id)!).filter(Boolean),
    channels: { bm25: lexical.slice(0, limit).map(r => r.id), topical: topics.slice(0, limit).map(r => r.id) },
  };
}
