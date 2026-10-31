package br.com.visionmidia.v2qa;

import android.content.Context;
import android.os.SystemClock;
import androidx.test.core.app.ApplicationProvider;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.SQLiteMode;

import java.util.List;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=28, manifest=Config.NONE)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
public class SequenceStoreTest {
    private Context context;
    private SequenceStore queue;
    private static final String DB="vision_v2_sequence_qa_only.db";
    private static final String BOOT_A="qa-boot-0001";
    private static final String BOOT_B="qa-boot-0002";
    private static final long OCT31 = 1793458800000L; // overridden in assertions by parsed timestamps
    @Before public void init(){
        context= ApplicationProvider.getApplicationContext();
        context.deleteDatabase(DB);
        queue=new SequenceStore(context);
        queue.provision("tv-qa-1","stream-qa-1",true);
    }
    @After public void clean(){
        if(queue!=null)queue.close();
        context.deleteDatabase(DB);
    }
    private SequenceStore.Sample clock(String boot,long ms){return new SequenceStore.Sample(boot,ms);}
    private SequenceStore.Playback event(int i){return new SequenceStore.Playback(String.format("event-%08d",i),"ad-1",true,15);}
    private long utc(String iso){
        try{
            java.text.SimpleDateFormat f=new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'",java.util.Locale.US);
            f.setLenient(false);f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            return f.parse(iso).getTime();
        }catch(Exception ex){throw new IllegalStateException(ex);}
    }
    private void trusted(String boot,long mono,String iso){
        queue.recordServerTime(clock(boot,mono),utc(iso),true);
    }
    private void reopen(){queue.close();queue=new SequenceStore(context);}
    private void expectContains(String term,Runnable r){
        try{r.run();fail("expected "+term);}
        catch(RuntimeException e){assertTrue("got "+e,e.toString().contains(term));}
    }
    @Test public void unprovisionedDatabaseFailsClosed(){
        queue.close();context.deleteDatabase(DB);queue=new SequenceStore(context);
        expectContains("not_provisioned_repair_required",()->queue.snapshot());
        expectContains("server_stream_required",()->queue.provision("tv-qa-1","stream-qa-1",false));
    }
    @Test public void noSecondProvisioningOrSilentReset(){
        expectContains("already_provisioned",()->queue.provision("tv-qa-1","stream-qa-1",true));
        assertEquals(1,queue.snapshot().nextSequence);
    }
    @Test public void transactionPersistsAcrossSQLiteCloseAndReopen(){
        assertEquals(1,queue.append(event(1),clock(BOOT_A,50),false));
        reopen();
        assertEquals(1,queue.snapshot().pending);assertEquals(2,queue.snapshot().nextSequence);
    }
    @Test public void simulatedCrashMidTransactionRollsBackBothEventAndCounter(){
        expectContains("simulated_power_loss",()->queue.append(event(1),clock(BOOT_A,50),true));
        reopen();
        assertEquals(0,queue.snapshot().pending);
        assertEquals(1,queue.snapshot().nextSequence);
        assertEquals(1,queue.append(event(1),clock(BOOT_A,50),false));
    }
    @Test public void retrySameEventAfterCallerLostCommitDoesNotAdvance(){
        queue.append(event(1),clock(BOOT_A,70),false);
        reopen();
        assertEquals(1,queue.append(event(1),clock(BOOT_A,70),false));
        assertEquals(1,queue.snapshot().pending);
    }
    @Test public void device1970CannotUseRTCAsTimestamp(){
        queue.append(event(1),clock(BOOT_A,30000),false);
        assertEquals(1,queue.snapshot().unresolved);
        assertTrue(queue.prepareBatch(true,50).isEmpty());
        assertTrue(queue.prepareBatch(false,50).isEmpty());
        assertEquals(0,queue.snapshot().sentThrough);
    }
    @Test public void rejectedAnchorCannotInventHistoricDay(){
        queue.append(event(1),clock(BOOT_A,500),false);
        expectContains("unverified_server_time",()->queue.recordServerTime(clock(BOOT_A,800),utc("2026-10-31T15:00:00Z"),false));
        expectContains("untrusted_time",()->queue.recordServerTime(clock(BOOT_A,800),utc("1970-01-01T00:00:00Z"),true));
        assertEquals(1,queue.snapshot().unresolved);
    }
    @Test public void trustedServerTimeRetroactivelyRepairsSameBootOnly(){
        queue.append(event(1),clock(BOOT_A,10000),false);
        assertEquals(1,queue.recordServerTime(clock(BOOT_A,20000),utc("2026-10-31T15:00:00Z"),true));
        List<SequenceStore.Event> batch=queue.prepareBatch(true,50);
        assertEquals(1,batch.size());
        assertEquals("2026-10-31T14:59:50.000Z",batch.get(0).playedAt);
        assertEquals("2026-10-31",batch.get(0).day);
    }
    @Test public void SaoPauloDayBoundaryIsNotUtcDay(){
        trusted(BOOT_A,1000,"2026-11-01T02:59:50Z");
        queue.append(event(1),clock(BOOT_A,1000),false);
        queue.append(event(2),clock(BOOT_A,21000),false);
        List<SequenceStore.Event> batch=queue.prepareBatch(true,50);
        assertEquals("2026-10-31",batch.get(0).day);
        assertEquals("2026-11-01",batch.get(1).day);
    }
    @Test public void anotherBootCannotInheritAnchor(){
        trusted(BOOT_A,1000,"2026-10-31T15:00:00Z");
        queue.append(event(1),clock(BOOT_A,2000),false);
        queue.append(event(2),clock(BOOT_B,2000),false);
        List<SequenceStore.Event> batch=queue.prepareBatch(true,50);
        assertEquals(1,batch.size());assertEquals(1,queue.snapshot().unresolved);
    }
    @Test public void unknownClockFromOldBootBlocksFifoEvenWhenNewBootVerified(){
        queue.append(event(1),clock(BOOT_A,1000),false);
        trusted(BOOT_B,3000,"2026-11-01T12:00:00Z");
        queue.append(event(2),clock(BOOT_B,4000),false);
        assertTrue(queue.prepareBatch(true,50).isEmpty());
        assertEquals(1,queue.snapshot().unresolved);
    }
    @Test public void ackAfterRestartOnlyRemovesSentPrefix(){
        trusted(BOOT_A,1000,"2026-10-31T15:00:00Z");
        queue.append(event(1),clock(BOOT_A,2000),false);
        queue.append(event(2),clock(BOOT_A,3000),false);
        assertEquals(1,queue.prepareBatch(true,1).size());
        reopen();
        queue.acknowledge(1,true);
        assertEquals(1,queue.snapshot().confirmed);
        assertEquals(1,queue.snapshot().pending);
        assertEquals(3,queue.snapshot().nextSequence);
    }
    @Test public void unverifiedAckAndAckBeyondSentRejected(){
        trusted(BOOT_A,1000,"2026-10-31T15:00:00Z");
        queue.append(event(1),clock(BOOT_A,2000),false);
        expectContains("unverified_ack",()->queue.acknowledge(1,false));
        expectContains("ack_out_of_range",()->queue.acknowledge(1,true));
        assertEquals(1,queue.snapshot().pending);
    }
    @Test public void lostAckResendsExactlySameSequence(){
        trusted(BOOT_A,1000,"2026-10-31T15:00:00Z");
        queue.append(event(1),clock(BOOT_A,2000),false);
        assertEquals(1,queue.prepareBatch(true,50).get(0).sequence);
        reopen();
        assertEquals(1,queue.prepareBatch(true,50).get(0).sequence);
        queue.acknowledge(1,true);
        assertEquals(0,queue.snapshot().pending);
    }
    @Test public void mismatchedEventIdFailsWithoutCounterChange(){
        queue.append(event(1),clock(BOOT_A,10),false);
        SequenceStore.Playback replacement=new SequenceStore.Playback("event-00000001","ad-other",true,15);
        expectContains("event_id_conflict",()->queue.append(replacement,clock(BOOT_A,20),false));
        assertEquals(2,queue.snapshot().nextSequence);
    }
    @Test public void androidMonotonicCaptureNotSystemWallClock(){
        SequenceStore.Sample sample=SequenceStore.Sample.capture("qa-boot-real");
        assertEquals("qa-boot-real",sample.bootId);
        assertTrue(sample.elapsedMs>=0);
        assertTrue(Math.abs(sample.elapsedMs-SystemClock.elapsedRealtime())<1000);
    }
    @Test public void skewedBootCounterCannotCarryTimeFor31Days(){
        trusted(BOOT_A,1000,"2026-10-31T15:00:00Z");
        queue.append(event(1),clock(BOOT_A,31L*86400000L+1000),false);
        assertEquals(1,queue.snapshot().unresolved);
        assertTrue(queue.prepareBatch(true,50).isEmpty());
    }
    @Test public void offlineNeverMarksEventsSent(){
        trusted(BOOT_A,1000,"2026-10-31T15:00:00Z");
        queue.append(event(1),clock(BOOT_A,1001),false);
        assertTrue(queue.prepareBatch(false,50).isEmpty());
        assertEquals(0,queue.snapshot().sentThrough);
    }
    @Test public void corruptedSequenceFailsClosed(){
        queue.append(event(1),clock(BOOT_A,1000),false);
        queue.getWritableDatabase().execSQL("UPDATE stream_state SET next_seq=10 WHERE id=1");
        expectContains("queue_gap_repair_required",()->queue.snapshot());
    }
}
