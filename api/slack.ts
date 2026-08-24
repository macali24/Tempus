/**
 * Slack alert relay (production).
 *
 * Mirrors the Vite dev middleware in vite.config.ts. The webhook URL is a
 * credential: anyone holding it can post into the channel, so it stays in the
 * server environment and the browser only ever posts the alert payload.
 *
 * Without this file the endpoint exists in development and 404s in production,
 * which is the failure mode where a rep believes an alert was sent.
 */
export const config = { runtime: 'edge' };

type Payload = {
  provider?: string;
  npi?: string;
  rank?: number;
  score?: number;
  reason?: string;
  profileUrl?: string;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return json(503, { error: 'Slack is not configured. Add SLACK_WEBHOOK_URL to the environment.' });

  let payload: Payload;
  try { payload = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { provider, npi, rank, score, reason, profileUrl } = payload;
  if (!provider || !npi || !Number.isFinite(score)) return json(400, { error: 'Invalid alert payload' });

  const slack = {
    text: `Tempus territory alert: ${provider} moved into an actionable segment.`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Priority provider signal' } },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Provider*\n${provider}` },
          { type: 'mrkdwn', text: `*Rank / score*\n#${rank} · ${score}/100` },
          { type: 'mrkdwn', text: `*NPI*\n${npi}` },
          { type: 'mrkdwn', text: '*Evidence rule*\nTop 5 · score ≥70 · confidence ≥70' },
        ],
      },
      { type: 'section', text: { type: 'mrkdwn', text: `*Recommended action*\n${reason}` } },
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open public NPI record' }, url: profileUrl }] },
    ],
  };

  try {
    const result = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slack),
    });
    if (!result.ok) return json(502, { error: `Slack webhook returned ${result.status}` });
    return json(200, { ok: true });
  } catch {
    return json(502, { error: 'Slack request failed' });
  }
}
