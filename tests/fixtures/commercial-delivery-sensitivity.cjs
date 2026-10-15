// OFFLINE LAB ONLY. Deterministic demand sensitivity, NOT actual billing or CDN hits.
// Scenario: each preview transmits the specified number of bytes in total.
// Increasing Range count increases requests, NOT bytes unless seeks re-download bytes.
'use strict';
const SIZES=Object.freeze([1_000_000,6_000_000,20_000_000]);
const RANGE_COUNTS=Object.freeze([1,4,12]);
const CACHE_FRACTIONS=Object.freeze([0,0.5,0.9]);
const GB=1_000_000_000;
function validInteger(value,min,max,label){
 if(!Number.isSafeInteger(value)||value<min||value>max)throw new RangeError('Invalid '+label);
}
function validRatio(value,label){
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)
  throw new RangeError('Invalid '+label);
}
function scenario({mediaBytes,rangesPerPreview,cacheByteFraction,previews=1000,
 proxyCacheByteFraction=0,repeatTransferFactor=1}){
 validInteger(mediaBytes,1,100_000_000_000,'mediaBytes');
 validInteger(rangesPerPreview,1,128,'rangesPerPreview');
 validInteger(previews,1,100_000_000,'previews');
 validRatio(cacheByteFraction,'cacheByteFraction');
 validRatio(proxyCacheByteFraction,'proxyCacheByteFraction');
 if(typeof repeatTransferFactor!=='number'||!Number.isFinite(repeatTransferFactor)||
  repeatTransferFactor<1||repeatTransferFactor>10)
  throw new RangeError('Invalid repeatTransferFactor');
 const deliveredBytes=mediaBytes*previews*repeatTransferFactor;
 const gets=rangesPerPreview*previews;
 if(!Number.isSafeInteger(deliveredBytes)||!Number.isSafeInteger(gets))
  throw new RangeError('Unsafe total');
 // Assume cacheByteFraction is an *achieved byte hit rate*, not a prediction.
 // A new distinct token per signature may make achieved cache far lower.
 const signedCachedBytes=deliveredBytes*cacheByteFraction;
 const proxyCachedBytes=deliveredBytes*proxyCacheByteFraction;
 return Object.freeze({
  mediaBytes,rangesPerPreview,cacheByteFraction,previews,repeatTransferFactor,
  deliveredBytes,rangeGets:gets,signOperations:previews,
  signedOriginBytes:deliveredBytes-signedCachedBytes,
  signedCachedBytes,
  proxyAuthorizationChecks:gets,
  proxyUpstreamOriginBytes:deliveredBytes-proxyCachedBytes,
  proxyUpstreamCachedBytes:proxyCachedBytes,
  proxyToBrowserBytes:deliveredBytes,
  proxyTotalTransportBytes:deliveredBytes*2,
  signedTotalMediaToBrowserBytes:deliveredBytes
 });
}
const matrix=(options={})=>SIZES.flatMap(size=>RANGE_COUNTS.flatMap(ranges=>
 CACHE_FRACTIONS.map(fraction=>scenario({
  mediaBytes:size,rangesPerPreview:ranges,cacheByteFraction:fraction,...options
 }))));
function markdown(rows){
 const columns=['Mídia (MB)','Ranges/prévia','Cache simulado','GETs',
  'Assinaturas','Origem A (GB)','Origem B (GB)','Saída proxy (GB)'];
 const val=n=>Number(n.toFixed(4)).toLocaleString('en-US',{maximumFractionDigits:4});
 const body=rows.map(r=>[
  val(r.mediaBytes/1e6),r.rangesPerPreview,Math.round(r.cacheByteFraction*100)+'%',
  r.rangeGets,r.signOperations,val(r.signedOriginBytes/GB),
  val(r.proxyUpstreamOriginBytes/GB),val(r.proxyToBrowserBytes/GB)
 ].join(' | '));
 return '| '+columns.join(' | ')+' |\n| '+columns.map(()=>'---:').join(' | ')+' |\n'+
  body.map(x=>'| '+x+' |').join('\n')+'\n';
}
module.exports={SIZES,RANGE_COUNTS,CACHE_FRACTIONS,scenario,matrix,markdown};
