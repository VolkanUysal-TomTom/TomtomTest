/**
 * Cloudflare Worker — GitHub OAuth proxy
 *
 * Exchanges a GitHub OAuth code for an access token.
 * The client_secret never touches the browser.
 *
 * Environment variables to set in Cloudflare dashboard:
 *   GITHUB_CLIENT_ID     = Ov23liEnfBzfWKcryH7j
 *   GITHUB_CLIENT_SECRET = (your client secret)
 *
 * Allowed origin: https://volkanuysal-tomtom.github.io
 */

const ALLOWED_ORIGIN = 'https://volkanuysal-tomtom.github.io';

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    let code;
    try {
      const body = await request.json();
      code = body.code;
    } catch {
      return json({ error: 'Invalid JSON body' }, 400, corsHeaders);
    }

    if (!code) {
      return json({ error: 'Missing code' }, 400, corsHeaders);
    }

    const ghRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        client_id:     env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const data = await ghRes.json();
    return json(data, ghRes.status, corsHeaders);
  },
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
