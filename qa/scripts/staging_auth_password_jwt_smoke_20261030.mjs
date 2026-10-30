// Vision staging only: real JWT acquisition and safe negative authorization test.
// Node 20+. No dependencies, no tokens/passwords printed or persisted.
// Required env: VISION_QA_PUBLISHABLE_KEY, VISION_QA_TEST_EMAIL, VISION_QA_TEST_PASSWORD
// Account must be dedicated to staging, created via Supabase Auth UI and email-confirmed.
const project = 'jmiuitrrhtaeyrpuyohk';
const base = 'https://' + project + '.supabase.co';
const key = process.env.VISION_QA_PUBLISHABLE_KEY;
const email = process.env.VISION_QA_TEST_EMAIL;
const password = process.env.VISION_QA_TEST_PASSWORD;
if (![key,email,password].every(Boolean)) {
  console.error('Missing staging publishable key or dedicated test account credentials in environment.');
  process.exit(2);
}
async function call(path,method,body,token,extra={}) {
  return fetch(base + path,{
    method,
    headers:{apikey:key,Authorization:'Bearer '+(token||key),'Content-Type':'application/json',...extra},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
    signal:AbortSignal.timeout(8000)
  });
}
const signIn = await call('/auth/v1/token?grant_type=password','POST',{email,password});
if (!signIn.ok) {
  console.error('Staging sign-in failed: HTTP '+signIn.status+' (no response body logged).');
  process.exit(1);
}
const auth = await signIn.json();
const token = auth.access_token;
if (!token) throw new Error('No access token returned');
const user = await call('/auth/v1/user','GET',undefined,token);
if (!user.ok) throw new Error('JWT verification failed: HTTP '+user.status);
console.log('PASS: staging JWT accepted by Auth /user; no identity or token printed.');
const rpc = await call('/rest/v1/rpc/playback_events_full_cursor_fixture','POST',{
  p_company_id:'11111111-1111-4111-8111-111111111111',
  p_start:'2026-10-30T00:00:00Z',p_end:'2026-10-31T00:00:00Z',p_limit:1
},token,{'Accept-Profile':'vision_qa','Content-Profile':'vision_qa'});
if (![401,403,404].includes(rpc.status)) {
  console.error('FAIL: unexpected RPC response HTTP '+rpc.status);
  process.exitCode=1;
} else console.log('PASS: isolated QA RPC inaccessible to authenticated test account (HTTP '+rpc.status+').');
try {
  const logout=await call('/auth/v1/logout','POST',undefined,token);
  console.log('Sign-out request HTTP '+logout.status+'.');
} catch { console.log('Sign-out request failed; allow short-lived session to expire.'); }
console.log('This tests a real Auth JWT and negative RPC access only. It does NOT validate successful RPC access or tenant isolation with a real JWT.');
