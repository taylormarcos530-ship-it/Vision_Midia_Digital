package com.visionmidia.liveprobe;
/** Monotonic-clock session gate, independent of Android and playback. */
public final class SessionPolicy {
 public enum State { IDLE, WAITING_CONSENT, CAPTURING, STOPPED }
 public static final long CONSENT_TIMEOUT_MS=30000, CAPTURE_TIMEOUT_MS=180000;
 private State state=State.IDLE;
 private long generation,startedAt;
 public synchronized long startRequest(long now){
  if(now<0||state==State.WAITING_CONSENT||state==State.CAPTURING)return -1;
  startedAt=now;state=State.WAITING_CONSENT;return ++generation;
 }
 public synchronized boolean consentResult(long id,boolean granted,long now){
  if(id!=generation||state!=State.WAITING_CONSENT)return false;
  if(!granted||isExpired(now)){state=State.STOPPED;return false;}
  state=State.CAPTURING;startedAt=now;return true;
 }
 public synchronized boolean stop(long id){
  if(id!=generation||(state!=State.WAITING_CONSENT&&state!=State.CAPTURING))return false;
  state=State.STOPPED;return true;
 }
 public synchronized boolean isExpired(long now){
  if(state!=State.WAITING_CONSENT&&state!=State.CAPTURING)return false;
  return now<startedAt||now-startedAt>=(state==State.WAITING_CONSENT?CONSENT_TIMEOUT_MS:CAPTURE_TIMEOUT_MS);
 }
 public synchronized State state(){return state;}
 public synchronized long generation(){return generation;}
}
