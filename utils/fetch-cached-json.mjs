/* Vision QA: independent verified JSON feeds, never auto-integrates with production. */
const TTL=10800000, TIMEOUT=8000, COOLDOWN=300000;
const MIN=Date.UTC(2024,0,1), MAX=Date.UTC(2035,0,1), SKEW=300000;
const requests=new Map(), sessionRetries=new Map();
const safeRead=(s,k)=>{try{return JSON.parse(s?.getItem(k)||'null')}catch{return null}};
const safeWrite=(s,k,v)=>{try{s?.setItem(k,JSON.stringify(v));return true}catch{return false}};
const validClock=(t,saved=null)=>Number.isFinite(t)&&t>=MIN&&t<MAX&&(!Number.isFinite(saved)||t>=saved-SKEW);
const safeMono=fn=>{try{const n=fn();return Number.isFinite(n)?n:0}catch{return 0}};
function getValidCache(storage,key,validate) {
  const c=safeRead(storage,key);
  if(!c||typeof c!=='object'||Array.isArray(c))return null;
  try{if(!validate(c.value))return null}catch{return null}
  return {value:c.value,savedAt:validClock(c.savedAt)?c.savedAt:null,
    checkedAt:validClock(c.checkedAt)?c.checkedAt:null};
}
function serverDate(response) {
  try{const d=response.headers?.get?.('date');const ms=d?Date.parse(d):null;return validClock(ms)?ms:null}
  catch{return null}
}
/** Always supply a strict validate function and unique cacheKey per feed. */
export async function fetchCachedJson(url, {
  cacheKey,validate,storage=globalThis.localStorage,fetchImpl=globalThis.fetch,
  ttlMs=TTL,timeoutMs=TIMEOUT,cooldownMs=COOLDOWN,
  now=()=>Date.now(),monotonicNow=()=>globalThis.performance?.now?.()??Date.now()
}={}) {
  if(typeof cacheKey!=='string'||!cacheKey.trim())throw new TypeError('cacheKey obrigatório');
  if(typeof validate!=='function')throw new TypeError('validate obrigatório');
  if(typeof fetchImpl!=='function')throw new TypeError('fetch indisponível');
  if(![ttlMs,timeoutMs,cooldownMs].every(n=>Number.isFinite(n)&&n>0))
    throw new TypeError('intervalo inválido');
  const cache=getValidCache(storage,cacheKey,validate);
  let state=safeRead(storage,cacheKey+':fetch-state');
  if(!state||typeof state!=='object'||Array.isArray(state))state={};
  const wall=now(),clockPlausible=validClock(wall,cache?.savedAt);
  const build=(value,source,stale,info={})=>({
    value,source,stale,
    _meta:{
      source,stale,clockPlausible,clockSynchronized:info.clockSynchronized===true,
      cachedAt:info.cachedAt===undefined?cache?.savedAt??null:info.cachedAt,
      lastServerCheckAt:info.lastServerCheckAt===undefined
        ?state.lastCheckAt??cache?.checkedAt??null:info.lastServerCheckAt,
      lastError:info.lastError===undefined?state.lastError??null:info.lastError,
      lastErrorAt:info.lastErrorAt===undefined?state.lastErrorAt??null:info.lastErrorAt,
      retryAfter:info.retryAfter===undefined?state.retryAfter??null:info.retryAfter,
      reason:info.reason??null
    }
  });
  if(cache&&clockPlausible&&cache.savedAt!==null&&wall>=cache.savedAt&&
     wall-cache.savedAt<ttlMs)return build(cache.value,'cache',false,{reason:'ttl'});
  const mono=safeMono(monotonicNow);
  const wallCooldown=clockPlausible&&Number.isFinite(state.retryAfter)&&wall<state.retryAfter&&
    wall>=(Number.isFinite(state.lastErrorAt)?state.lastErrorAt:0);
  const sessionCooldown=Number.isFinite(sessionRetries.get(cacheKey))&&mono<sessionRetries.get(cacheKey);
  if(wallCooldown||sessionCooldown)
    return build(cache?.value??null,cache?'cache':'unavailable',true,{reason:'cooldown'});
  const key=cacheKey+'|'+String(url);
  if(requests.has(key))return requests.get(key);
  const job=(async()=>{
    const ctrl=new AbortController();
    let timeout;
    try{
      const fetchAndParse=(async()=>{
        const r=await fetchImpl(url,{signal:ctrl.signal,cache:'no-store'});
        if(r?.ok!==true)throw new Error('HTTP '+(r?.status??'sem resposta'));
        const remoteTime=serverDate(r);
        const value=await r.json();
        if(!validate(value))throw new Error('Payload inválido');
        return {value,remoteTime};
      })();
      const deadline=new Promise((_,reject)=>{
        timeout=setTimeout(()=>{ctrl.abort();reject(new Error('Timeout '+timeoutMs+' ms'))},timeoutMs)
      });
      const {value,remoteTime}=await Promise.race([fetchAndParse,deadline]);
      const newWall=now(),savedAt=remoteTime??(validClock(newWall,cache?.savedAt)?newWall:null);
      // Never overwrite the validated offline record with an Epoch/future timestamp.
      if(savedAt!==null)safeWrite(storage,cacheKey,{value,savedAt,checkedAt:savedAt});
      state={...state,lastCheckAt:savedAt??state.lastCheckAt??null,retryAfter:null};
      safeWrite(storage,cacheKey+':fetch-state',state);
      sessionRetries.delete(cacheKey);
      return build(value,'network',false,{
        reason:savedAt===null?'clock-unreliable-not-saved':'updated',
        cachedAt:savedAt,lastServerCheckAt:savedAt,retryAfter:null,
        clockSynchronized:remoteTime!==null&&validClock(newWall)&&Math.abs(newWall-remoteTime)<=SKEW
      });
    }catch(e){
      const error=String(e?.message||e||'Erro desconhecido').slice(0,250);
      const at=now(),valid=validClock(at,cache?.savedAt);
      sessionRetries.set(cacheKey,safeMono(monotonicNow)+cooldownMs);
      state={...state,lastError:error,lastErrorAt:valid?at:null,retryAfter:valid?at+cooldownMs:null};
      safeWrite(storage,cacheKey+':fetch-state',state);
      return build(cache?.value??null,cache?'cache':'unavailable',true,
        {reason:'request-failed',lastError:error,lastErrorAt:state.lastErrorAt,
          retryAfter:state.retryAfter});
    }finally{if(timeout!==undefined)clearTimeout(timeout)}
  })();
  requests.set(key,job);
  try{return await job}finally{requests.delete(key)}
}
