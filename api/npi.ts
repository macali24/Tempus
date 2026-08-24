/**
 * NPPES proxy.
 *
 * The federal NPI Registry sends no CORS headers, so a browser cannot call it
 * directly. This forwards the query untouched and returns the response as-is;
 * no field is altered, filtered, or cached.
 */
export const config = { runtime: 'edge' };

export default async function handler(request: Request): Promise<Response> {
  const incoming = new URL(request.url);
  const target = new URL('https://npiregistry.cms.hhs.gov/api/');
  incoming.searchParams.forEach((value, key) => target.searchParams.set(key, value));

  const upstream = await fetch(target, { headers: { Accept: 'application/json' } });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  });
}
