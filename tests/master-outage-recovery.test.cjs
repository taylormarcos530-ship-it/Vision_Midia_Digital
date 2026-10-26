const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const masterJs=fs.readFileSync('master.js','utf8');
const start=masterJs.indexOf('  let verifiedMasterEmail = null;');
const end=masterJs.indexOf('  function setView(',start);
assert.ok(start>=0&&end>start);
function makeMaster({role='super_admin',email='admin@example.test',serverError=null}={}){
  const state={data:{companies:[{name:'Tenant example'}]},role,session:{access_token:'test-token'}};
  const pill={className:'',textContent:''};
  let calls=0,logoutCalls=0,now=100000;
  const context=vm.createContext({state,Math,
    $:()=>pill,
    document:{hidden:false},
    Date:{now:()=>now},
    master:async()=>{if(serverError)throw serverError;return {role,email}},
    load:async()=>{calls++},
    logout:()=>{logoutCalls++;state.data=null;state.role=null},
  });
  vm.runInContext(masterJs.slice(start,end)+
    '\nthis.ops={setConn,recoverMasterWhenAvailable,setVerifiedEmail:(value)=>{verifiedMasterEmail=value},getRetry:()=>masterRetryAt};',context);
  context.ops.setVerifiedEmail(email);
  return {state,pill,ops:context.ops,get calls(){return calls},get logoutCalls(){return logoutCalls},setTime(v){now=v}};
}
test('Master shows stale state as unavailable, keeps verified snapshot in memory only',()=>{
  const m=makeMaster();m.ops.setConn(false);
  assert.match(m.pill.textContent,/dados anteriores/);
  assert.ok(m.state.data);
  assert.doesNotMatch(masterJs.slice(start,end),/localStorage|sessionStorage/);
});
test('reconnecting to Master checks identity before refreshing any data',async()=>{
  const m=makeMaster();m.ops.setConn(false);await m.ops.recoverMasterWhenAvailable();
  assert.equal(m.calls,1);assert.equal(m.logoutCalls,0);
});
test('offline backend never simulates successful Master refresh',async()=>{
  const m=makeMaster({serverError:{status:504}});m.ops.setConn(false);
  await m.ops.recoverMasterWhenAvailable();
  assert.equal(m.calls,0);assert.equal(m.logoutCalls,0);
  assert.ok(m.ops.getRetry()>100000);
  assert.ok(m.state.data);
});
test('unauthorized Master recovery revokes old snapshot',async()=>{
  const m=makeMaster({serverError:{status:403}});m.ops.setConn(false);
  await m.ops.recoverMasterWhenAvailable();
  assert.equal(m.logoutCalls,1);assert.equal(m.state.data,null);
});
test('Master always verifies whoami before loading dashboard',()=>{
  assert.match(masterJs,/const current = await master\(\{ action: 'whoami' \}\)/);
  assert.match(masterJs,/String\(current\.email \|\| ''\)\.toLowerCase\(\) !== verifiedMasterEmail/);
  assert.match(masterJs,/masterReconnectInFlight/);
});
