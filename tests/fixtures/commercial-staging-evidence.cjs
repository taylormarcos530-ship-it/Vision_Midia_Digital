// OFFLINE LAB ONLY. Safe evidence references for a FUTURE isolated staging review.
// Neither a repository test nor an evidence digest verifies staging or permits deploy.
// Never store JWT, signed URLs, customer data, production IDs or raw HTTP logs here.
'use strict';
const {GATES,STATES,baseline,assess}=require('./commercial-staging-readiness.cjs');

const VERSION=1;
const PROVENANCE=Object.freeze(['LAB','STAGING']);
const REQUIREMENTS=Object.freeze({
 'ENV-01':'ENVIRONMENT_INVENTORY',
 'ENV-02':'SYNTHETIC_IDENTITY_MATRIX',
 'SQL-01':'NEGATIVE_COLUMN_PRIVILEGES',
 'SQL-02':'RPC_REDACTION_SCHEMA',
 'RLS-01':'TENANT_ISOLATION_MATRIX',
 'RLS-02':'ACCESS_REVOCATION_TRACE',
 'COPY-01':'SEPARATE_COPY_MANIFEST',
 'URL-01':'SIGNED_URL_TTL_TRACE',
 'URL-02':'RESIDUAL_ACCESS_TRACE',
 'CDN-01':'CACHE_BEHAVIOR_REPORT',
 'VIDEO-01':'MEDIA_BROWSER_RUN',
 'WEBVIEW-01':'WEBVIEW_COMPAT_MATRIX',
 'SESSION-01':'SESSION_RACE_BROWSER_RUN',
 'LOG-01':'REDACTION_SCAN',
 'COST-01':'CONTRACTUAL_USAGE_REPORT',
 'DECISION-01':'BUSINESS_POLICY_APPROVAL',
 'ROLLBACK-01':'STAGING_ROLLBACK_DRILL'
});
const REF=/^EV-[A-Z0-9]{8,16}$/;
const SHA256=/^[a-f0-9]{64}$/;
const DATE=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function plain(x){
 return x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
}
function shape(x,keys,label){
 if(!plain(x)||Object.keys(x).length!==keys.length||
  !keys.every(k=>own(x,k)))throw new TypeError('Invalid fields at '+label);
}
function newForm(){
 const current=baseline();
 return {
  version:VERSION,
  scope:'ISOLATED_STAGING_ONLY',
  environment:{...current.environment},
  policy:{...current.policy},
  approvals:{...current.approvals},
  checks:GATES.map(g=>({
   id:g.id,status:current.checks.find(c=>c.id===g.id).status,evidence:[]
  }))
 };
}
function verify(form){
 shape(form,['version','scope','environment','policy','approvals','checks'],'root');
 if(form.version!==VERSION||form.scope!=='ISOLATED_STAGING_ONLY')
  throw new TypeError('Unsupported schema or staging-only scope');
 shape(form.environment,['approvedForStaging','isolated','productionCredentialsExcluded'],'environment');
 shape(form.policy,['selected','residualAccepted'],'policy');
 shape(form.approvals,['reviewerSignedOff','productionDeployAuthorized'],'approvals');
 for(const [group,keys] of [
  [form.environment,['approvedForStaging','isolated','productionCredentialsExcluded']],
  [form.policy,['residualAccepted']],
  [form.approvals,['reviewerSignedOff','productionDeployAuthorized']]
 ])for(const k of keys)if(typeof group[k]!=='boolean')
  throw new TypeError('Expected boolean '+k);
 if(!['UNDECIDED','SIGNED_SHORT','AUTH_PER_READ'].includes(form.policy.selected))
  throw new TypeError('Unknown delivery policy');
 if(form.approvals.productionDeployAuthorized!==false)
  throw new TypeError('Production authorization is outside this staging-only form');
 if(!Array.isArray(form.checks)||form.checks.length!==GATES.length)
  throw new TypeError('Exactly 17 staging checks required');
 const encounteredGates=new Set(),encounteredRefs=new Set();
 const normalized=[];
 for(const row of form.checks){
  shape(row,['id','status','evidence'],'criterion');
  if(!own(REQUIREMENTS,row.id)||encounteredGates.has(row.id))
   throw new TypeError('Unknown or duplicate staging criterion');
  encounteredGates.add(row.id);
  if(!STATES.includes(row.status))throw new TypeError('Unknown evidence status');
  if(!Array.isArray(row.evidence)||row.evidence.length>10)
   throw new TypeError('Evidence list must contain 0-10 entries');
  const requiredType=REQUIREMENTS[row.id];
  let accepted=0;
  const safeRefs=[];
  for(const item of row.evidence){
   shape(item,['ref','type','source','sha256','observedAt'],'evidence');
   if(typeof item.ref!=='string'||!REF.test(item.ref)||encounteredRefs.has(item.ref))
    throw new TypeError('Invalid or replayed opaque evidence reference');
   encounteredRefs.add(item.ref);
   if(item.type!==requiredType||!PROVENANCE.includes(item.source))
    throw new TypeError('Evidence type or source does not match criterion');
   if(typeof item.sha256!=='string'||!SHA256.test(item.sha256))
    throw new TypeError('SHA256 digest must be redacted hexadecimal only');
   if(typeof item.observedAt!=='string'||!DATE.test(item.observedAt)||
    Number.isNaN(Date.parse(item.observedAt))||
    new Date(item.observedAt).toISOString()!==
     (item.observedAt.length===20?item.observedAt.replace('Z','.000Z'):item.observedAt))
    throw new TypeError('Invalid canonical UTC observation time');
   // Hashes assert artifact identity, NOT authenticity, completeness or authorization.
   // No raw artifact, URL, sensitive path, free-text note or login credential is accepted.
   if(item.source==='STAGING')accepted++;
   safeRefs.push('proof:'+item.ref+':'+item.source);
  }
  if(row.status==='PASS'&&accepted===0)
   throw new TypeError('PASS requires a matching staging-source reference for '+row.id);
  normalized.push({id:row.id,status:row.status,evidence:safeRefs});
 }
 const result=assess({
  environment:form.environment,policy:form.policy,approvals:form.approvals,checks:normalized
 });
 return Object.freeze({...result,
  evidenceCount:encounteredRefs.size,
  labOnlyEvidenceCount:form.checks.reduce((n,x)=>n+x.evidence.filter(v=>v.source==='LAB').length,0),
  stagingEvidenceCount:form.checks.reduce((n,x)=>n+x.evidence.filter(v=>v.source==='STAGING').length,0),
  // Neither human review eligibility nor self-reported hashes authorize any action.
  canConnectStaging:false,
  canDeployToProduction:false
 });
}
function render(form){
 const checked=verify(form);
 const lines=[
  '# Vision — inventário de evidências redigidas',
  '',
  '**Escopo:** staging segregado, ainda sujeito a autorização humana externa.',
  '**Status:** '+(checked.readyForHumanStagingReview?'Elegível apenas para REVISÃO HUMANA':'BLOQUEADO / NÃO HOMOLOGADO'),
  '**Aprovações reais concedidas por este arquivo:** nenhuma.',
  '',
  '| Critério | Situação | Referências opacas |',
  '|---|---|---|'
 ];
 for(const g of GATES){
  const row=form.checks.find(x=>x.id===g.id);
  const refs=row.evidence.map(e=>e.ref+' ('+e.source+')');
  lines.push('| '+g.id+' | '+row.status+' | '+(refs.join(', ')||'sem evidência')+' |');
 }
 lines.push('','**Pendências:** '+checked.blockers.length+
  '. **Evidências registradas:** '+checked.evidenceCount+
  ' (LAB '+checked.labOnlyEvidenceCount+', STAGING '+checked.stagingEvidenceCount+').');
 lines.push('**Deploy de produção:** proibido. **Staging real:** não autorizado automaticamente.');
 return lines.join('\n')+'\n';
}
module.exports={VERSION,PROVENANCE,REQUIREMENTS,newForm,verify,render};
