/**
 * Model provider abstraction.
 *
 * Three properties matter here:
 *
 *  1. Keys never reach the bundle. The client posts to /api/llm; the dev server
 *     (and the serverless function in production) holds the credential.
 *  2. Failover. If a provider is unconfigured or erroring we fall through to the
 *     next one, and finally to a deterministic assembler that needs no key at
 *     all, so the prototype is fully functional for a reviewer with no setup.
 *  3. Provider choice is explicit. The validator's entailment gate MUST run on a
 *     different provider than generation, otherwise it is self-grading.
 *  4. House style is enforced here, not per call site. Every system prompt
 *     carries the em dash ban and every returned string is stripped, so a
 *     provider that ignores the instruction still cannot put one on screen.
 */
import { STYLE_RULE, stripEmDashes } from './style';
export type ProviderId = 'gemini' | 'groq' | 'deterministic';

export type LlmResult = {
  text: string;
  provider: ProviderId;
  model: string;
  latencyMs: number;
  /** True when no external model ran and the deterministic path produced this. */
  offline: boolean;
};

export type CompleteOptions = {
  system?: string;
  /** Providers to try, in order. */
  prefer?: ProviderId[];
  /** Never use these; used to force cross-model verification. */
  exclude?: ProviderId[];
  temperature?: number;
  /** Deterministic text to return if every model provider is unavailable. */
  fallback?: () => string;
};

let availabilityCache: { providers: ProviderId[]; at: number } | null = null;

/**
 * Gateway origin. Empty in the browser (same-origin /api/llm). Test harnesses
 * and Node scripts point this at a local server so the full cross-model path
 * can be exercised without shipping credentials into a test.
 */
let gatewayBase = '';

export function setGatewayBase(base: string) {
  gatewayBase = base.replace(/\/$/, '');
  availabilityCache = null;
}

/** Ask the server which providers actually have credentials configured. */
export async function availableProviders(): Promise<ProviderId[]> {
  if (availabilityCache && Date.now() - availabilityCache.at < 60_000) return availabilityCache.providers;
  try {
    const response = await fetch(`${gatewayBase}/api/llm/status`);
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json();
    const providers: ProviderId[] = [...(data.providers ?? []), 'deterministic'];
    availabilityCache = { providers, at: Date.now() };
    return providers;
  } catch {
    availabilityCache = { providers: ['deterministic'], at: Date.now() };
    return availabilityCache.providers;
  }
}

/** Every call carries the house style rules, whatever the caller asked for. */
const withHouseStyle = (system?: string) => (system ? `${system}\n\n${STYLE_RULE}` : STYLE_RULE);

export async function complete(prompt: string, options: CompleteOptions = {}): Promise<LlmResult> {
  const started = Date.now();
  const available = await availableProviders();
  const order = (options.prefer ?? ['gemini', 'groq', 'deterministic'])
    .filter(p => !options.exclude?.includes(p))
    .filter(p => available.includes(p));

  for (const provider of order) {
    if (provider === 'deterministic') break;
    try {
      const response = await fetch(`${gatewayBase}/api/llm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, prompt, system: withHouseStyle(options.system), temperature: options.temperature ?? 0.2 }),
      });
      if (!response.ok) continue;
      const data = await response.json();
      if (!data.text) continue;
      return { text: stripEmDashes(data.text), provider, model: data.model ?? provider, latencyMs: Date.now() - started, offline: false };
    } catch {
      continue; // try the next provider
    }
  }

  return {
    text: stripEmDashes(options.fallback?.() ?? ''),
    provider: 'deterministic',
    model: 'rule-based-assembler',
    latencyMs: Date.now() - started,
    offline: true,
  };
}

/** Models wrap JSON in prose or fences more often than not. Recover it. */
export function extractJson<T>(text: string): T | undefined {
  if (!text) return undefined;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.search(/[[{]/);
  if (start === -1) return undefined;
  const opening = candidate[start];
  const closing = opening === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === opening) depth++;
    else if (ch === closing) {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(candidate.slice(start, i + 1)) as T; } catch { return undefined; }
      }
    }
  }
  return undefined;
}
