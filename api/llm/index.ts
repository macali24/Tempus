/**
 * Model gateway (production).
 *
 * Mirrors the Vite dev middleware in vite.config.ts. Credentials are read from
 * the server environment and never reach the client bundle; the browser only
 * ever posts a provider name and a prompt.
 */
export const config = { runtime: 'edge' };

type Body = { provider?: 'gemini' | 'groq'; prompt?: string; system?: string; temperature?: number };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  let payload: Body;
  try { payload = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { provider, prompt, system, temperature = 0.2 } = payload;
  if (!prompt) return json(400, { error: 'Missing prompt' });

  const key = provider === 'gemini' ? process.env.GEMINI_API_KEY : provider === 'groq' ? process.env.GROQ_API_KEY : undefined;
  if (!key) return json(503, { error: `${provider ?? 'provider'} is not configured` });

  try {
    if (provider === 'gemini') {
      const model = 'gemini-2.0-flash';
      const result = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          systemInstruction: system ? { parts: [{ text: system }] } : undefined,
          generationConfig: { temperature },
        }),
      });
      if (!result.ok) return json(502, { error: `Gemini returned ${result.status}` });
      const data = await result.json();
      return json(200, { text: data.candidates?.[0]?.content?.parts?.[0]?.text ?? '', model });
    }

    const model = 'llama-3.3-70b-versatile';
    const result = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature,
        messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }],
      }),
    });
    if (!result.ok) return json(502, { error: `Groq returned ${result.status}` });
    const data = await result.json();
    return json(200, { text: data.choices?.[0]?.message?.content ?? '', model });
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : 'Gateway failure' });
  }
}
