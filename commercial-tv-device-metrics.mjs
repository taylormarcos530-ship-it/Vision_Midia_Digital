// Offline diagnostic helpers. All measurements are local browser observations, not TV certifications.
export function viewportReport(width,height,dpr=1){
 const w=Number(width),h=Number(height),scale=Number(dpr);
 if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0)
  return {valid:false,orientation:'unknown',width:0,height:0,pixelRatio:1};
 return {valid:true,width:Math.round(w),height:Math.round(h),
  pixelRatio:Number.isFinite(scale)&&scale>0&&scale<=10?scale:1,
  orientation:w>h?'horizontal':h>w?'vertical':'quadrado'};
}
export function decodeSupport(canPlayType){
 // canPlayType reports only declared browser support. Actual decode must be tested with a file.
 const formats=[
  {name:'MP4/H.264',mime:'video/mp4; codecs="avc1.42E01E"'},
  {name:'WebM/VP8',mime:'video/webm; codecs="vp8"'},
  {name:'WebM/VP9',mime:'video/webm; codecs="vp9"'}
 ];
 return formats.map(f=>{
  let result='';
  try{result=typeof canPlayType==='function'?canPlayType(f.mime):'';}catch{/* unsupported */}
  return {...f,level:result==='probably'?'provável':result==='maybe'?'possível':'não declarado'};
 });
}
export function canUseLabFile(file){
 return Boolean(file&&Number.isFinite(file.size)&&file.size>0&&
  file.size<=100*1024*1024&&/^(video\/mp4|video\/webm)$/.test(file.type||''));
}
