package com.visionmidia.liveprobe;
public class SessionPolicyTest {
 static int checks;
 static void check(boolean ok,String reason){checks++;if(!ok)throw new AssertionError(reason);}
 public static void main(String[] args){
  SessionPolicy p=new SessionPolicy();
  check(p.state()==SessionPolicy.State.IDLE,"initial idle");
  check(p.startRequest(-1)==-1,"negative clock rejected");
  long a=p.startRequest(100);
  check(a>0,"generation");check(p.startRequest(101)==-1,"duplicate start");
  check(!p.consentResult(a,false,110),"denied");check(p.state()==SessionPolicy.State.STOPPED,"denial closes");
  long b=p.startRequest(200);check(b>a,"new generation");
  check(!p.consentResult(a,true,210),"stale consent");check(p.state()==SessionPolicy.State.WAITING_CONSENT,"stale does not stop new session");
  check(!p.isExpired(30199),"consent before boundary");check(p.isExpired(30200),"consent exact boundary");
  check(!p.consentResult(b,true,30200),"late consent rejected");
  long c=p.startRequest(40000);check(p.consentResult(c,true,40010),"valid consent");
  check(!p.consentResult(c,true,40011),"consent single use");check(p.startRequest(40012)==-1,"no overlapping capture");
  check(!p.isExpired(220009),"capture before boundary");check(p.isExpired(220010),"capture exact boundary");
  check(!p.stop(b),"stale stop");check(p.state()==SessionPolicy.State.CAPTURING,"stale stop preserves session");
  check(p.stop(c),"stop");check(!p.stop(c),"idempotent stop");
  p.startRequest(300000);check(p.isExpired(299999),"backwards clock fails closed");
  System.out.println("SessionPolicy: "+checks+" checks passed");
 }
}
