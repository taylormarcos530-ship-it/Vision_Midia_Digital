// Experimental only. Never use Promise.race to free the single-flight slot:
// an aborted transport may still be executing on the server.
// This adapter requests cancellation at the deadline but waits for settlement
// before allowing the scheduler to issue another command query.
export function createAbortableCommandPoll({
 request, schedule, cancel, timeoutMs=8000, onTimeout=()=>{}
}){
 if(typeof request!=='function'||typeof schedule!=='function'||typeof cancel!=='function')throw Error('request, schedule, cancel required')
 let current=null
 async function poll(){
  if(current)throw Error('command request already in flight')
  const controller=new AbortController()
  const flight={controller,timer:null,expired:false}
  current=flight
  flight.timer=schedule(()=>{
   flight.timer=null
   flight.expired=true
   controller.abort()
   onTimeout()
  },timeoutMs)
  try{
   const result=await request({signal:controller.signal})
   if(flight.expired)throw Error('command request timed out')
   return result
  }finally{
   if(flight.timer!==null)cancel(flight.timer)
   if(current===flight)current=null
  }
 }
 return {
  poll,
  abort(){if(current)current.controller.abort()},
  get state(){return {inFlight:current!==null,timeoutRequested:Boolean(current?.expired)}}
 }
}
