/** Which providers have credentials. Names only, never the keys themselves. */
export const config = { runtime: 'edge' };

export default async function handler(): Promise<Response> {
  const providers = [
    process.env.GEMINI_API_KEY ? 'gemini' : null,
    process.env.GROQ_API_KEY ? 'groq' : null,
  ].filter(Boolean);

  return new Response(JSON.stringify({ providers }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
