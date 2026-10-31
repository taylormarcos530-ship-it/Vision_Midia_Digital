package br.com.visionmidia.v2qa;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteException;
import android.database.sqlite.SQLiteFullException;
import androidx.test.core.app.ApplicationProvider;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.SQLiteMode;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=28,manifest=Config.NONE)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
public final class SegmentedOfflineQueueTest {
    private Context context;
    private SegmentedOfflineQueue queue;
    private static final String BOOT_A="seven-day-boot-A";
    private static final String BOOT_B="seven-day-boot-B";
    @Before public void setup() {
        context=ApplicationProvider.getApplicationContext();
        context.deleteDatabase(SegmentedOfflineQueue.DB_NAME);
        queue=new SegmentedOfflineQueue(context);
        queue.provision("tv-v2qa","stream-v2qa",true);
    }
    @After public void tearDown() {
        if(queue!=null) queue.close();
        context.deleteDatabase(SegmentedOfflineQueue.DB_NAME);
    }
    private SegmentedOfflineQueue.Entry event(int seq,String boot,long step) {
        return new SegmentedOfflineQueue.Entry(
            String.format(Locale.US,"receipt-%08d",seq),
            "media-"+(seq%10),boot,step,15.0,true);
    }
    private List<SegmentedOfflineQueue.Entry> batch(int start,int count,String boot,long interval) {
        ArrayList<SegmentedOfflineQueue.Entry> b=new ArrayList<>(count);
        for(int i=start;i<start+count;i++)b.add(event(i,boot,1000L+i*interval));
        return b;
    }
    private long utc(String iso) {
        try{
            SimpleDateFormat f=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'",Locale.US);
            f.setTimeZone(TimeZone.getTimeZone("UTC")); f.setLenient(false);
            return f.parse(iso).getTime();
        }catch(Exception ex){throw new AssertionError(ex);}
    }
    private void reopen(){queue.close();queue=new SegmentedOfflineQueue(context);}
    private void expect(String token,Runnable r) {
        try{r.run();fail("expected "+token);}
        catch(RuntimeException ex){assertTrue("got "+ex,ex.toString().contains(token));}
    }
    private long count(String sql){
        try(Cursor c=queue.getReadableDatabase().rawQuery(sql,null)){
            assertTrue(c.moveToFirst());return c.getLong(0);
        }
    }
    private long sevenDayEvents() {
        final int n=7*24*60*60/15; // 40320
        for(int i=1;i<=n;i+=SegmentedOfflineQueue.SEGMENT_SIZE){
            int length=Math.min(SegmentedOfflineQueue.SEGMENT_SIZE,n-i+1);
            queue.appendBatch(batch(i,length,BOOT_A,15000));
        }
        return n;
    }
    private void printSize(String tag){
        File db=context.getDatabasePath(SegmentedOfflineQueue.DB_NAME);
        File wal=new File(db.getPath()+"-wal");
        File shm=new File(db.getPath()+"-shm");
        System.out.println("V2_SEGMENT_METRIC "+tag+
           " rows="+queue.countedRows()+" segments="+queue.segments()+
           " page_bytes="+queue.pageBytes()+
           " db_file="+(db.exists()?db.length():0)+
           " wal_file="+(wal.exists()?wal.length():0)+
           " shm_file="+(shm.exists()?shm.length():0)+
           " pending="+queue.pending()+" unresolved="+queue.unresolved());
    }

    @Test public void sevenDaysOfflineContinuousAll40320ReceiptsPersistIn40Segments(){
        long n=sevenDayEvents();
        assertEquals(40320,n);
        assertEquals(n,queue.pending());
        assertEquals(n,queue.unresolved());
        assertEquals(40,queue.segments());
        assertEquals(n+1,queue.next());
        assertEquals(0,queue.sent());
        assertEquals(0,queue.acknowledged());
        assertEquals("ok",queue.integrity());
        queue.verifyLogical();
        printSize("SEVEN_DAYS_BEFORE_REOPEN");
        assertTrue("DB > 64 MiB",queue.pageBytes() <= SegmentedOfflineQueue.MAX_DATABASE_BYTES);
        reopen();
        assertEquals(n,queue.pending());
        assertEquals(40,queue.segments());
        assertEquals("ok",queue.integrity());
        queue.verifyLogical();
        printSize("SEVEN_DAYS_AFTER_REOPEN");
        assertTrue(queue.prepare(false,50).isEmpty());
        assertTrue(queue.prepare(true,50).isEmpty()); // never invent RTC 1970
    }

    @Test public void fiftyThousandPendingHardCapRefuses50001WithoutOverwrite(){
        int limit=SegmentedOfflineQueue.MAX_PENDING;
        for(int i=1;i<=limit;i+=SegmentedOfflineQueue.SEGMENT_SIZE) {
            int length=Math.min(SegmentedOfflineQueue.SEGMENT_SIZE,limit-i+1);
            queue.appendBatch(batch(i,length,BOOT_A,15000));
        }
        assertEquals(limit,queue.pending());
        assertEquals(limit+1,queue.next());
        assertEquals(49,queue.segments());
        expect("pending_capacity_reached",()->queue.appendBatch(batch(limit+1,1,BOOT_A,15000)));
        reopen();
        assertEquals(limit,queue.pending());
        assertEquals(limit+1,queue.next());
        assertEquals("ok",queue.integrity());
        queue.verifyLogical();
        printSize("FIFTY_THOUSAND_CAP");
        assertTrue(queue.pageBytes()<=SegmentedOfflineQueue.MAX_DATABASE_BYTES);
    }

    @Test public void ackAndSegmentReleaseKeepCountersCorrectAfterReopen(){
        queue.appendBatch(batch(1,1024,BOOT_A,15000));
        queue.appendBatch(batch(1025,1024,BOOT_A,15000));
        queue.trustedTime(BOOT_A,1000+2048*15000L,
           utc("2026-11-01T15:00:00Z"),true);
        assertEquals(2,queue.segments());
        int rounds=0;
        while(queue.pending()>0) {
            List<SegmentedOfflineQueue.Outgoing> sent=queue.prepare(true,50);
            assertTrue(sent.size()>0 && sent.size()<=50);
            queue.ack(sent.get(sent.size()-1).seq,true);
            rounds++;
            if(rounds>50)fail("ack loop");
        }
        assertEquals(0,queue.pending());
        assertEquals(0,queue.segments());
        assertEquals(2049,queue.next());
        assertEquals(2048,queue.acknowledged());
        assertEquals("ok",queue.integrity());
        queue.verifyLogical();
        printSize("AFTER_ACK_2048");
        reopen();
        queue.verifyLogical();
        queue.appendBatch(batch(2049,1024,BOOT_A,15000));
        assertEquals(1024,queue.pending());
        assertTrue(queue.pageBytes()<=SegmentedOfflineQueue.MAX_DATABASE_BYTES);
        printSize("AFTER_REUSE_1024");
    }

    @Test public void genuineSqliteFullAtPageQuotaDoesNotLeavePartialBatch(){
        SQLiteDatabase db=queue.getWritableDatabase();
        long starting=queue.pageBytes();
        long count=db.rawQuery("PRAGMA page_count",null).getCount(); // not used; only for API coverage
        assertTrue(starting>0 && count>0);
        long pages=page("PRAGMA page_count");
        long max=page("PRAGMA max_page_count="+(pages+2));
        assertEquals(pages+2,max);
        boolean full=false;int attempts=0;
        try {
            while(attempts++<60){
                long original=queue.next();
                try {queue.appendBatch(batch((int)original,128,BOOT_A,15000));}
                catch(SQLiteFullException e){
                    full=true;
                    System.out.println("V2_SQLITE_FULL_CLASS="+e.getClass().getName());
                    System.out.println("V2_SQLITE_FULL_CAUSE="+e.getMessage());
                    break;
                }
            }
            assertTrue("SQLiteFullException not observed under quota",full);
            assertEquals(queue.next()-1,queue.pending());
        }finally{
            page("PRAGMA max_page_count="+(SegmentedOfflineQueue.MAX_DATABASE_BYTES/page("PRAGMA page_size")));
        }
        reopen();
        assertEquals("ok",queue.integrity());
        queue.verifyLogical();
        long next=queue.next();
        queue.appendBatch(batch((int)next,1,BOOT_A,15000));
        assertEquals(next+1,queue.next());
    }
    private long page(String sql){
        try(Cursor c=queue.getWritableDatabase().rawQuery(sql,null)){
            assertTrue(c.moveToFirst());return c.getLong(0);
        }
    }

    @Test public void midBatchFaultRollsBackAllRowsSegmentsAndCounter(){
        SQLiteDatabase db=queue.getWritableDatabase();
        db.execSQL("CREATE TRIGGER qa_inject BEFORE INSERT ON receipts "+
             "WHEN NEW.seq=10 BEGIN SELECT RAISE(ABORT,'disk_injected');END");
        expect("disk_injected",()->queue.appendBatch(batch(1,70,BOOT_A,15000)));
        assertEquals(0,queue.pending());
        assertEquals(1,queue.next());
        assertEquals(0,queue.segments());
        assertEquals(0,queue.countedRows());
        db.execSQL("DROP TRIGGER qa_inject");
        queue.appendBatch(batch(1,70,BOOT_A,15000));
        reopen();
        assertEquals(70,queue.pending());
        assertEquals("ok",queue.integrity());
        queue.verifyLogical();
    }

    @Test public void overlappingPlaybackIdFailsAtomicallyInsteadOfDoubling(){
        queue.appendBatch(batch(1,2,BOOT_A,15000));
        List<SegmentedOfflineQueue.Entry> second=new ArrayList<>();
        second.add(event(3,BOOT_A,45000));
        second.add(event(2,BOOT_A,30000)); // duplicate unique event ID
        try {queue.appendBatch(second);fail("duplicate accepted");}
        catch(SQLiteException expected){ /* unique index, rollback whole batch */ }
        assertEquals(2,queue.pending());
        assertEquals(3,queue.next());
        queue.verifyLogical();
    }

    @Test public void previousBootWithoutClockRemainsUnsentAndAudited(){
        queue.appendBatch(batch(1,2,BOOT_A,15000));
        reopen();
        queue.trustedTime(BOOT_B,2000,utc("2026-11-08T15:00:00Z"),true);
        queue.appendBatch(batch(3,2,BOOT_B,15000));
        assertEquals(2,queue.unresolved());
        assertEquals(4,queue.pending());
        assertTrue(queue.prepare(true,50).isEmpty()); // FIFO blocks later dates
        assertEquals(2,queue.stageUnresolved());
        assertEquals(2,queue.auditCount());
        queue.annotateUnverifiable(1,"review-case-0001");
        assertEquals(3,queue.auditReviews());
        assertEquals(0,queue.sent());
        assertEquals(0,queue.acknowledged());
        reopen();
        assertEquals(2,queue.auditCount());
        assertEquals(4,queue.pending());
        assertEquals("ok",queue.integrity());
        assertTrue(queue.prepare(true,50).isEmpty());
        printSize("OLD_BOOT_UNVERIFIED");
    }

    @Test public void sameBootServerAnchorResolvesWithoutUsingRTC1970(){
        queue.appendBatch(batch(1,3,BOOT_A,15000));
        assertTrue(queue.prepare(true,50).isEmpty());
        queue.trustedTime(BOOT_A,1000+3*15000L,utc("2026-11-08T15:00:00Z"),true);
        assertEquals(0,queue.unresolved());
        List<SegmentedOfflineQueue.Outgoing> send=queue.prepare(true,50);
        assertEquals(3,send.size());
        assertEquals(1,send.get(0).seq);
        assertEquals("2026-11-08T14:59:30.000Z",send.get(0).playedAt);
        queue.ack(3,true);
        assertEquals(0,queue.pending());
        assertEquals(0,queue.segments());
    }

    @Test public void auditOriginalAndReviewsCannotBeRewritten(){
        queue.appendBatch(batch(1,1,BOOT_A,15000));
        assertEquals(1,queue.stageUnresolved());
        SQLiteDatabase db=queue.getWritableDatabase();
        expect("audit_immutable",()->db.execSQL("DELETE FROM audit_proofs WHERE seq=1"));
        expect("audit_immutable",()->db.execSQL("UPDATE audit_reviews SET code='FAKE_TIME' WHERE seq=1"));
        assertEquals(1,queue.auditCount());
        assertEquals(1,queue.auditReviews());
        assertEquals(1,queue.unresolved());
    }

    @Test public void backlogCannotAdvanceSentOrAckWhenOffline(){
        queue.appendBatch(batch(1,1024,BOOT_A,15000));
        assertTrue(queue.prepare(false,50).isEmpty());
        assertTrue(queue.prepare(true,50).isEmpty());
        expect("unverified_ack",()->queue.ack(1,false));
        expect("ack_out_of_range",()->queue.ack(1,true));
        assertEquals(0,queue.sent());
        assertEquals(0,queue.acknowledged());
        queue.verifyLogical();
    }
}
