// Audit-only fail-closed recovery gate. A promise that ignores AbortSignal
// cannot be safely replaced by another command poll until it settles.
// No speculative retries: transport termination must be confirmed.
export function createQuarantinedCommandPoll({request,schedule,cancel,timeoutMs=8000,onQuarantine=()=>{}}){
 if(typeof request!=='function'||typeof schedule!=='function'||typeof cancel!=='function')throw Error('invalid dependencies')
 let flight=null,quarantined=false
 async function poll(){
  if(flight||quarantined)throw Error('command channel busy/quarantined')
  const controller=new AbortController()
  const entry={controller,timer:null,expired:false}
  flight=entry
  entry.timer=schedule(()=>{
   entry.timer=null;entry.expired=true;quarantined=true
   controller.abort()
   onQuarantine()
  },timeoutMs)
  try{
   const result=await request({signal:controller.signal})
   if(entry.expired)throw Error('command poll timed out')
   return result
  }finally{
   if(entry.timer!==null)cancel(entry.timer)
   if(flight===entry)flight=null
   // Release quarantine only after transport actually settled.
   if(!flight)quarantined=false
  }
 }
 return {
  poll,
  get state(){return {inFlight:!!flight,quarantined}},
  abort(){flight?.controller.abort()}
 }
}
