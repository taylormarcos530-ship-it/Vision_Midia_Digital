// Vision QA only — negative authorization smoke test.
// Run locally with Node.js 20+ and credentials supplied via environment variables.
// Do not commit keys, JWTs or .env files. Never point this script at production.
const { VISION_QA_SUPABASE_URL: base, VISION_QA_PUBLISHABLE_KEY: key, VISION_QA_TEST_JWT: jwt } = process.env;
if (!base || !key) {
  console.error('Missing VISION_QA_SUPABASE_URL or VISION_QA_PUBLISHABLE_KEY.');
  process.exit(2);
}
const url = new URL(base);
if (url.protocol !== 'https:' || url.hostname !== 'jmiuitrrhtaeyrpuyohk.supabase.co') {
  console.error('Safety stop: only the Vision staging project is allowed.');
  process.exit(2);
}
const endpoint = new URL('/rest/v1/rpc/playback_events_full_cursor_fixture', url);
const body = {
  p_company_id: '11111111-1111-4111-8111-111111111111',
  p_start: '2026-10-30T00:00:00Z',
  p_end: '2026-10-31T00:00:00Z',
  p_limit: 1
};
async function check(label, token) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Profile': 'vision_qa',
      'Content-Profile': 'vision_qa'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000)
  });
  // Current security posture: schema and RPC are not exposed to anon/authenticated.
  // A 404 can mean schema is not exposed to PostgREST; 401/403 are authorization denials.
  const denied = [401, 403, 404].includes(response.status);
  console.log(label + ': HTTP ' + response.status + ' — ' + (denied ? 'DENIED as expected' : 'UNEXPECTED; inspect safely'));
  if (!denied) process.exitCode = 1;
}
await check('Anonymous', key);
if (jwt) await check('Test authenticated JWT', jwt);
else console.log('Real-JWT check NOT RUN: supply a dedicated staging test-user JWT in environment, never in chat or source control.');
console.log('Note: negative HTTP tests do not prove successful JWT authorization or tenant isolation.');
