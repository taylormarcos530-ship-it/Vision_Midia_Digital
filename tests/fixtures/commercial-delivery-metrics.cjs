// INTERNAL TEST FIXTURE ONLY. Quantities are synthetic local HTTP measurements.
// This module intentionally never accepts or records token, URL, object path, headers or JWT.
'use strict';
const MODES=['signed','proxy'];
const KINDS=['sign','get','head'];
const percentile=(sorted,p)=>{
 if(!sorted.length)return null;
 return Number(sorted[Math.max(0,Math.ceil(sorted.length*p)-1)].toFixed(3));
};
function finiteInteger(n,name,max=Number.MAX_SAFE_INTEGER){
 if(!Number.isSafeInteger(n)||n<0||n>max)throw new RangeError('Invalid '+name);
}
function collector(){
 const entries=[];
 return Object.freeze({
  record({mode,kind,status,bodyBytes=0,originBytes=0,proxyOutboundBytes=0,
   cacheHit=false,rangeRequest=false,elapsedMs}){
   if(!MODES.includes(mode)||!KINDS.includes(kind))throw new TypeError('Invalid category');
   finiteInteger(status,'status',599);
   if(status<100)throw new RangeError('Invalid HTTP status');
   finiteInteger(bodyBytes,'bodyBytes');
   finiteInteger(originBytes,'originBytes');
   finiteInteger(proxyOutboundBytes,'proxyOutboundBytes');
   if(typeof cacheHit!=='boolean'||typeof rangeRequest!=='boolean')throw new TypeError('Invalid flag');
   if(typeof elapsedMs!=='number'||!Number.isFinite(elapsedMs)||elapsedMs<0||elapsedMs>1e7)
    throw new RangeError('Invalid latency');
   // Only these safe typed fields are allowed, not raw request metadata.
   entries.push(Object.freeze({mode,kind,status,bodyBytes,originBytes,
    proxyOutboundBytes,cacheHit,rangeRequest,elapsedMs}));
  },
  summary(){
   const result={};
   for(const mode of MODES){
    const e=entries.filter(x=>x.mode===mode);
    const media=e.filter(x=>x.kind==='get');
    const durations=media.map(x=>x.elapsedMs).sort((a,b)=>a-b);
    const statuses={};
    for(const x of e)statuses[x.status]=(statuses[x.status]||0)+1;
    const sum=key=>e.reduce((n,x)=>n+x[key],0);
    result[mode]={
     totalRequests:e.length,
     signRequests:e.filter(x=>x.kind==='sign').length,
     mediaGetRequests:media.length,
     headRequests:e.filter(x=>x.kind==='head').length,
     rangeRequests:media.filter(x=>x.rangeRequest).length,
     successfulGetResponses:media.filter(x=>x.status===200||x.status===206).length,
     cacheHits:media.filter(x=>x.cacheHit).length,
     errors403:e.filter(x=>x.status===403).length,
     errors416:e.filter(x=>x.status===416).length,
     statuses,bodyBytes:sum('bodyBytes'),
     originBytes:sum('originBytes'),
     proxyOutboundBytes:sum('proxyOutboundBytes'),
     latencyMs:{p50:percentile(durations,.5),p95:percentile(durations,.95),
      samples:durations.length}
    };
   }
   return result;
  },
  size(){return entries.length}
 });
}
module.exports={collector,percentile};
