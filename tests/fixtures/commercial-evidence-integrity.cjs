// OFFLINE LAB ONLY: checks real SHA-256 of synthetic files, NOT provenance.
// Never read customer assets, production paths, external URLs, or connect to staging.
// This verification does not change statuses or authorize staging / production.
'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash,timingSafeEqual}=require('node:crypto');
const {verify}=require('./commercial-staging-evidence.cjs');

const MAX_BYTES=16*1024;
const FIXTURE_DIR=path.resolve(__dirname,'commercial-evidence-lab');
const STATES=Object.freeze(['MATCH','MISMATCH','MISSING','REJECTED','SOURCE_UNVERIFIED']);
function isExactFixtureDir(dir){
 if(typeof dir!=='string')return false;
 const resolved=path.resolve(dir);
 const temporary=path.dirname(resolved)===path.resolve(os.tmpdir())&&
  /^vision-evidence-lab-[A-Za-z0-9_-]+$/.test(path.basename(resolved));
 return resolved===FIXTURE_DIR||temporary;
}
function syntheticShape(body,ref,gate){
 try{
  const parsed=JSON.parse(body.toString('utf8'));
  if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')return false;
  const keys=Object.keys(parsed).sort();
  return keys.join('|')==='fixture|gate|ref|result'&&
   parsed.fixture==='VISION-LAB-ONLY'&&parsed.gate===gate&&
   parsed.ref===ref&&parsed.result==='SIMULATED';
 }catch{return false}
}
function hashOfBytes(bytes){
 return createHash('sha256').update(bytes).digest('hex');
}
function examineFile(root,ref,gate,declaredDigest){
 let fd;
 try{
  const target=path.join(root,ref+'.json'); // Reference is strict EV-[A-Z0-9] only.
  const before=fs.lstatSync(target);
  if(!before.isFile()||before.isSymbolicLink()||before.size===0||
   before.size>MAX_BYTES||before.nlink!==1)return 'REJECTED';
  fd=fs.openSync(target,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.size===0||stat.size>MAX_BYTES||stat.nlink!==1||
    stat.dev!==before.dev||stat.ino!==before.ino)return 'REJECTED';
  const bytes=fs.readFileSync(fd);
  if(bytes.length!==stat.size||!syntheticShape(bytes,ref,gate))return 'REJECTED';
  const actual=Buffer.from(hashOfBytes(bytes),'hex');
  const expected=Buffer.from(declaredDigest,'hex');
  return actual.length===expected.length&&timingSafeEqual(actual,expected)?
   'MATCH':'MISMATCH';
 }catch(e){
  if(e&&e.code==='ENOENT')return 'MISSING';
  return 'REJECTED';
 }finally{if(fd!==undefined)fs.closeSync(fd)}
}
function verifyLocalFixtureHashes(form,options={}){
 const schema=verify(form); // Strict schema, unique refs, redacted fields.
 if(!options||typeof options!=='object'||Array.isArray(options)||
   Object.keys(options).some(k=>k!=='directory'))
  throw new TypeError('Only an isolated fixture directory is allowed');
 const requested=options.directory===undefined?FIXTURE_DIR:options.directory;
 if(!isExactFixtureDir(requested))throw new TypeError('Not a permitted synthetic fixture directory');
 let root;
 try{
  const state=fs.lstatSync(requested);
  if(!state.isDirectory()||state.isSymbolicLink())throw Error('Unsafe fixture folder');
  root=fs.realpathSync(requested);
  if(!isExactFixtureDir(root)||root!==path.resolve(requested))
   throw Error('Unsafe fixture folder');
 }catch{throw new TypeError('Fixture directory unavailable or unsafe')}
 const outcomes=[];
 for(const row of form.checks)for(const evidence of row.evidence){
  const hashStatus=evidence.source==='LAB'?
   examineFile(root,evidence.ref,row.id,evidence.sha256):'SOURCE_UNVERIFIED';
  outcomes.push(Object.freeze({id:row.id,ref:evidence.ref,source:evidence.source,
   hashStatus}));
 }
 const totals={MATCH:0,MISMATCH:0,MISSING:0,REJECTED:0,SOURCE_UNVERIFIED:0};
 for(const outcome of outcomes)totals[outcome.hashStatus]++;
 return Object.freeze({
  total:outcomes.length,totals:Object.freeze(totals),
  outcomes:Object.freeze(outcomes),
  // Self-reported STAGING evidence is intentionally NOT read or authenticated
  // by a LAB fixture verifier, regardless of a possible claimed PASS.
  stagingProvenanceVerified:false,
  allLocalLabHashesMatch:outcomes.some(x=>x.source==='LAB')&&
    outcomes.filter(x=>x.source==='LAB').every(x=>x.hashStatus==='MATCH'),
  schemaReadyForHumanReview:schema.readyForHumanStagingReview,
  canConnectStaging:false,canRunRealStaging:false,canDeployToProduction:false
 });
}
function renderIntegrity(result){
 if(!result||!Array.isArray(result.outcomes)||!result.totals)
  throw new TypeError('Invalid synthetic verification');
 const lines=[
  '# Vision — conferência SHA-256 de evidências fictícias',
  '',
  '**Ambiente:** laboratório local; origem em staging NÃO verificada.',
  '**Staging real / produção:** não autorizados por este relatório.',
  '',
  '| Critério | Ref. opaca | Origem declarada | Hash local |',
  '|---|---|---|---|'
 ];
 for(const x of result.outcomes){
  if(!STATES.includes(x.hashStatus))throw new TypeError('Invalid result');
  lines.push('| '+x.id+' | '+x.ref+' | '+x.source+' | '+x.hashStatus+' |');
 }
 lines.push('','**Conferências locais:** '+result.totals.MATCH+
  '; **divergências:** '+result.totals.MISMATCH+
  '; **ausentes:** '+result.totals.MISSING+
  '; **rejeitadas:** '+result.totals.REJECTED+
  '; **origem não conferida:** '+result.totals.SOURCE_UNVERIFIED+'.');
 lines.push('**Hash coincidente não prova autenticidade, auditoria nem aprovação de staging.**');
 return lines.join('\n')+'\n';
}
module.exports={FIXTURE_DIR,MAX_BYTES,verifyLocalFixtureHashes,renderIntegrity,hashOfBytes};
