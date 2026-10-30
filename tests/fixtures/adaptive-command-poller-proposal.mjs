// Isolated proposal only: not imported by the production Player.
// One in-flight poll, bounded backoff, offline pause and immediate reconnect.
// Acknowledgment and screenshot handling remain in the existing poll callback.
export function createAdaptiveCommandPoller({
  poll, online, schedule, cancel, idleMs=30000, activeMs=5000,
  activeWindowMs=60000, errorMs=30000, now=()=>Date.now()
}) {
  if(typeof poll!=='function'||typeof online!=='function') throw Error('poll and online required')
  let running=false, inFlight=false, timer=null, activeUntil=0, generation=0
  function clear() { if(timer!==null) { cancel(timer);timer=null } }
  function queue(ms) {
    clear()
    if(running&&online()) timer=schedule(()=>{timer=null;void tick()},ms)
  }
  async function tick() {
    if(!running||!online()||inFlight) return
    const version=generation
    inFlight=true
    let delay=errorMs
    try {
      const result=await poll()
      if(version!==generation||!running) return
      if(result?.commandsFound>0) activeUntil=now()+activeWindowMs
      delay=now()<activeUntil?activeMs:idleMs
    } catch { delay=errorMs }
    finally {
      inFlight=false
      if(version===generation&&running&&online()) queue(delay)
    }
  }
  return {
    start() {if(running)return;running=true;generation++;if(online())queue(0)},
    stop() {running=false;generation++;clear();activeUntil=0},
    networkChanged() {if(!running)return;generation++;clear();if(online())queue(0)},
    get state() {return {running,inFlight,timerScheduled:timer!==null,activeUntil}}
  }
}
