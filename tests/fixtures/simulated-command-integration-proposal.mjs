// Audit-only simulated integration coordinator. Never imported by player.js.
// Keeps only one command poll active and rejects results from obsolete sessions.
export function createSimulatedCommandIntegration({poll, schedule, cancel, online=()=>true, idleMs=15000, fallbackMs=5000}){
 let generation=0,token=null,running=false,mode='adaptive',timer=null,busy=false,activeUntil=0
 const ack=new Set(),processing=new Set()
 const now=()=>clockNow()
 let clockNow=()=>0
 function setClock(fn){clockNow=fn}
 function clear(){if(timer!==null){cancel(timer);timer=null}}
 function queue(ms){clear();if(running&&online())timer=schedule(()=>{timer=null;void tick()},ms)}
 async function tick(){
  if(!running||!online()||busy)return
  busy=true
  const g=generation,t=token
  let delay=30000
  try{
   const commands=await poll(t)
   if(!running||g!==generation||t!==token)return
   let actionable=0
   for(const cmd of commands||[]){
    if(cmd.type!=='screenshot'||ack.has(cmd.id)||processing.has(cmd.id))continue
    actionable++
    processing.add(cmd.id)
    try{
     // Mocked server result: false/throw = uncertain ACK, never claim success.
     if(await cmd.capture(t)){
      if(!running||g!==generation||t!==token)continue
      const confirmed=await cmd.ack(t)
      if(confirmed&&running&&g===generation&&t===token)ack.add(cmd.id)
     }
    }catch{/* uncertain result remains unacknowledged for server reconciliation */}
    finally{processing.delete(cmd.id)}
   }
   if(actionable>0)activeUntil=now()+60000
   delay=mode==='fixed'?fallbackMs:now()<activeUntil?5000:idleMs
  }catch{delay=30000}
  finally{
   busy=false
   if(running&&online())queue(g===generation?delay:0)
  }
 }
 return {
  setClock,
  start(nextToken){generation++;token=nextToken;running=true;activeUntil=0;clear();if(online())queue(0)},
  stop(){running=false;generation++;clear();activeUntil=0},
  rollback(){mode='fixed';generation++;clear();activeUntil=0;if(running&&online())queue(busy?0:fallbackMs)},
  get state(){return {mode,running,busy,scheduled:timer!==null,ack:[...ack],processing:[...processing]}}
 }
}
