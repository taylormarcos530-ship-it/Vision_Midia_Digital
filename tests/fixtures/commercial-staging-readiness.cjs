// OFFLINE LAB ONLY — prospective staging acceptance criteria, NOT a deployment gate.
// No secrets, real endpoints, customer data, migration, remote calls or production actions.
'use strict';
const GATES=Object.freeze([
 {id:'ENV-01',area:'isolation',severity:'critical',name:'Isolated approved staging project',
  expected:'Independent project and bucket, separate credentials and no production devices or objects',
  evidence:'Reviewed environment inventory and approval, with project IDs masked'},
 {id:'ENV-02',area:'isolation',severity:'critical',name:'Synthetic identities and assets only',
  expected:'Advertisers A/B, owner, outsider, anonymous and Master are fictitious; no customer data imported',
  evidence:'Seed manifest and role-to-object matrix with pseudonymous labels'},
 {id:'SQL-01',area:'database',severity:'critical',name:'Direct revision SELECT excludes point source metadata',
  expected:'Authenticated cannot SELECT source_storage_path/source_media_id/source_updated_at/checksum or SELECT *',
  evidence:'SQL role-scoped negative tests and verified column privileges'},
 {id:'SQL-02',area:'database',severity:'critical',name:'SECURITY DEFINER response is redacted',
  expected:'Portal RPC returns allowlisted revision fields, no source metadata or original media path',
  evidence:'Recorded redacted RPC schema and both A/B negative assertions'},
 {id:'RLS-01',area:'authorization',severity:'critical',name:'Tenant-scoped campaign and object RLS',
  expected:'A cannot read B; B cannot read A; owner, outsider and anon cannot read commercial data',
  evidence:'Authenticated matrix for SQL rows, Storage SELECT and sign denial'},
 {id:'RLS-02',area:'authorization',severity:'critical',name:'Disabling advertiser revokes NEW access',
  expected:'Disabled A gets denied RPC, rows and NEW signatures while B still succeeds',
  evidence:'Before/after per-role status trace, excluding JWTs and signed URLs'},
 {id:'COPY-01',area:'media',severity:'critical',name:'Commercial snapshot separated from point playlist',
  expected:'Each preview is independent commercial-ads/UUID file, never owner storage_path; no playlist mutation',
  evidence:'Storage object manifest, checksum relation under authorized redacted evidence'},
 {id:'URL-01',area:'delivery',severity:'critical',name:'Signed URL path, host and expiration',
  expected:'Only own commercial copy, requested TTL <= 60s; disallowed source/host rejected',
  evidence:'Status/time trace without bearer query strings, verified server-side'},
 {id:'URL-02',area:'delivery',severity:'critical',name:'Residual bearer exposure documented',
  expected:'After revocation, new sign fails; old signed URL TTL and actual origin behavior measured, no instant-revoke claim',
  evidence:'Clock-aligned 200/403 trace with tokens redacted and business acceptance'},
 {id:'CDN-01',area:'delivery',severity:'high',name:'Cache and CDN behavior measured',
  expected:'Cache-control headers, warm/miss, token-per-URL cache keys and post-expiry behavior observed separately',
  evidence:'Non-sensitive HTTP headers, CDN status and timestamped byte totals'},
 {id:'VIDEO-01',area:'compatibility',severity:'critical',name:'Image and real H264 MP4 previews load',
  expected:'Real images, MP4 metadata, 206/416 Range, invalid MP4/404 fallback and video controls verified',
  evidence:'Browser test report and synthetic media fixtures for intended browsers'},
 {id:'WEBVIEW-01',area:'compatibility',severity:'critical',name:'Target Android/WebView compatibility',
  expected:'Supported OS/WebView versions confirmed on an authorized test device/emulator; no customer TV touched',
  evidence:'Version matrix and test recordings without customer identifiers'},
 {id:'SESSION-01',area:'authorization',severity:'critical',name:'Logout, refresh and rejected session race',
  expected:'Delayed previews never reappear after logout/token change/403; browser session and dashboard cleared',
  evidence:'Real browser deferred-request trace and assertions'},
 {id:'LOG-01',area:'privacy',severity:'critical',name:'Sensitive links and credentials absent from audit',
  expected:'Console, server, error telemetry and artifacts do not expose JWT, signedURL, bearer or owner path',
  evidence:'Redaction scan result; do not retain sensitive log exemplars'},
 {id:'COST-01',area:'cost',severity:'high',name:'Actual staging bandwidth and contractual pricing',
  expected:'Measure GET/Range, bytes, origin/cache, errors, function time; use actual plan, quota and approved budget',
  evidence:'Redacted usage report plus linked official rate sheet/date, no synthetic USD billed'},
 {id:'DECISION-01',area:'policy',severity:'critical',name:'Business signs residual-access policy',
  expected:'Explicit choice: short bearer residual window acceptable OR authenticated delivery verified for native video',
  evidence:'Written choice, owner approval and residual exposure acknowledgement'},
 {id:'ROLLBACK-01',area:'operations',severity:'critical',name:'Reversible staging plan and operational protection',
  expected:'Rollback limited to staging; no migrations, deploys, Edge releases, player changes or production playlist effects',
  evidence:'Reviewed diff, staging-only rollback drill and protected-file check'}
].map(x=>Object.freeze(x)));
const STATES=Object.freeze(['NOT_RUN','PASS','FAIL','BLOCKED']);
const ids=new Set(GATES.map(x=>x.id));
const forbidden=/(\bBearer\s+\S+|token=|signedURL["']?\s*[:=]|source_storage_path\s*[:=]\s*["'][^"']+|\/storage\/v1\/object\/sign\/|service[_-]?role[_-]?key)/i;
function evidenceSafe(text){
 return typeof text==='string'&&text.length>=8&&text.length<=500&&!forbidden.test(text);
}
function baseline(){
 return {
  environment:{approvedForStaging:false,isolated:false,productionCredentialsExcluded:false},
  policy:{selected:'UNDECIDED',residualAccepted:false},
  approvals:{reviewerSignedOff:false,productionDeployAuthorized:false},
  checks:GATES.map(g=>({id:g.id,status:g.id==='SQL-01'||g.id==='SQL-02'?'BLOCKED':'NOT_RUN',
    evidence:[],note:g.id==='SQL-01'||g.id==='SQL-02'?
    'Production-reviewable SQL currently grants full revision SELECT / to_jsonb projection; lab patch only':null}))
 };
}
function assess(candidate){
 if(!candidate||!Array.isArray(candidate.checks)||candidate.checks.length!==GATES.length)
  throw new TypeError('Every staging gate must be represented exactly once');
 if(!candidate.environment||!candidate.policy||!candidate.approvals)
  throw new TypeError('Missing environment, policy or approval block');
 const found=new Set();
 const blockers=[];
 for(const row of candidate.checks){
  if(!row||!ids.has(row.id)||found.has(row.id)||!STATES.includes(row.status))
   throw new TypeError('Unknown, duplicate or invalid staging gate');
  found.add(row.id);
  if(!Array.isArray(row.evidence)||row.evidence.some(v=>!evidenceSafe(v)))
   throw new TypeError('Invalid/redaction-unsafe evidence marker in '+row.id);
  if(row.status==='PASS'&&row.evidence.length===0)
   throw new TypeError('PASS without independent evidence: '+row.id);
  if(row.status!=='PASS')blockers.push(row.id+':'+row.status);
 }
 const env=candidate.environment;
 if(env.approvedForStaging!==true||env.isolated!==true||env.productionCredentialsExcluded!==true)
  blockers.push('STAGING_NOT_EXPLICITLY_AUTHORIZED_AND_ISOLATED');
 const decision=candidate.policy;
 if(!['SIGNED_SHORT','AUTH_PER_READ'].includes(decision.selected))
  blockers.push('DELIVERY_POLICY_UNDECIDED');
 if(decision.selected==='SIGNED_SHORT'&&decision.residualAccepted!==true)
  blockers.push('RESIDUAL_BEARER_EXPOSURE_NOT_ACCEPTED');
 if(candidate.approvals.reviewerSignedOff!==true)
  blockers.push('REVIEWER_SIGNOFF_MISSING');
 // A CI check can only produce an assessment for human review.
 // Even an all-green assessment NEVER invokes or authorizes production deploys.
 return Object.freeze({total:GATES.length,passed:candidate.checks.filter(x=>x.status==='PASS').length,
  blockers,readyForHumanStagingReview:blockers.length===0,
  canRunRealStaging:false,canDeployToProduction:false});
}
module.exports={GATES,STATES,baseline,assess,evidenceSafe};
