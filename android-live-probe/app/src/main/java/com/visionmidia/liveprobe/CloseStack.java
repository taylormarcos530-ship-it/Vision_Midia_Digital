package com.visionmidia.liveprobe;
import java.util.ArrayDeque;
/** Releases partial allocations in reverse order, even after one release fails. */
public final class CloseStack {
 private final ArrayDeque<Runnable> actions=new ArrayDeque<>();
 private boolean closed;
 public synchronized void add(Runnable release){if(closed)release.run();else actions.push(release);}
 public synchronized int close(){
  if(closed)return 0;closed=true;int failures=0;
  while(!actions.isEmpty()){try{actions.pop().run();}catch(RuntimeException e){failures++;}}
  return failures;
 }
}
