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
import java.util.Locale;
import static org.junit.Assert.*;

/**
 * ALL tests run in disposable native SQLite/Robolectric, not an Android TV.
 * PRAGMA max_page_count forces genuine SQLITE_FULL (not a synthetic exception).
 * It does NOT reproduce physical flash exhaustion or power removal.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk=28, manifest=Config.NONE)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
public final class SequenceStoreCapacityTest {
    private static final String DB="vision_v2_sequence_qa_only.db";
    private static final String BOOT="qa-boot-0001";
    private Context ctx;
    private SequenceStore queue;
    @Before public void setup(){
        ctx= ApplicationProvider.getApplicationContext();
        ctx.deleteDatabase(DB);
        queue=new SequenceStore(ctx);
        queue.provision("tv-capacity-qa","stream-capacity-qa",true);
    }
    @After public void clean() {
        if(queue!=null)queue.close();
        ctx.deleteDatabase(DB);
    }
    private SequenceStore.Playback event(int i) {
        return new SequenceStore.Playback(String.format(Locale.US,"capacity-%08d",i),"advert-1",true,15);
    }
    private SequenceStore.Sample time(int i) {
        return new SequenceStore.Sample(BOOT,i+1);
    }
    private long number(String sql) {
        try(Cursor c=queue.getReadableDatabase().rawQuery(sql,null)) {
            assertTrue(c.moveToFirst());return c.getLong(0);
        }
    }
    private String text(String sql) {
        try(Cursor c=queue.getReadableDatabase().rawQuery(sql,null)){
            assertTrue(c.moveToFirst());return c.getString(0);
        }
    }
    private void assertHealthy() {
        assertEquals("ok",text("PRAGMA integrity_check"));
        assertEquals("ok",text("PRAGMA quick_check"));
    }
    private void reopen() { queue.close();queue=new SequenceStore(ctx); }
    @Test public void integrityCheckPassesBeforeAndAfterNormalRestart() {
        assertHealthy();
        queue.append(event(1),time(1),false);
        reopen();
        assertHealthy();
        assertEquals(1,queue.snapshot().pending);
        assertEquals(2,queue.snapshot().nextSequence);
    }
    @Test public void realSqliteFullByPageLimitRollsBackCounterAndReceipt() {
        SQLiteDatabase db=queue.getWritableDatabase();
        long pages=number("PRAGMA page_count");
        long goal=pages+1;
        long accepted=number("PRAGMA max_page_count="+goal);
        assertEquals("page limit not applied",goal,accepted);
        boolean gotRealFull=false;
        long before=0;
        int faultAt=-1;
        // Fail with SQLITE_FULL via physical database page quota, not a trigger.
        try {
            for(int i=1;i<=500;i++){
                before=queue.snapshot().nextSequence;
                try { queue.append(event(i),time(i),false); }
                catch(SQLiteFullException full){ gotRealFull=true;faultAt=i;break; }
                catch(SQLiteException other){throw new AssertionError("expected SQLiteFullException, got "+other,other);}
            }
            assertTrue("SQLite never hit SQLITE_FULL under max_page_count="+goal,gotRealFull);
            assertEquals("counter advanced after failed insert",before,queue.snapshot().nextSequence);
            assertEquals(before-1,queue.snapshot().pending);
        } finally {
            // Remove limit on disposable QA database for checks, without deleting data.
            number("PRAGMA max_page_count=2147483646");
        }
        reopen();
        assertHealthy();
        assertEquals(before,queue.snapshot().nextSequence);
        assertEquals(before-1,queue.snapshot().pending);
        assertEquals(before,queue.append(event(faultAt),time(faultAt),false));
    }
    @Test public void twoThousandPendingEventsAreRetainedAndNextOneDenied() {
        // Construct first 1999 rows in one atomic SQL fixture to avoid 1999
        // linear integrity scans in this test; use real append for edge cases.
        SQLiteDatabase db=queue.getWritableDatabase();
        db.beginTransaction();
        try {
            for(int i=1;i<=1999;i++){
                db.execSQL("INSERT INTO pending(seq,event_id,media,completed,seconds,boot_id,elapsed_ms,utc_ms,played_day) VALUES(?,?,?,?,?,?,?,NULL,NULL)",
                    new Object[]{i,event(i).eventId,"advert-1",1,15,BOOT,i});
            }
            db.execSQL("UPDATE stream_state SET next_seq=2000 WHERE id=1");
            db.setTransactionSuccessful();
        }finally{db.endTransaction();}
        assertEquals(1999,queue.snapshot().pending);
        assertEquals(2000,queue.append(event(2000),time(2000),false));
        assertEquals(2000,queue.snapshot().pending);
        assertEquals(2001,queue.snapshot().nextSequence);
        try {queue.append(event(2001),time(2001),false);fail("overflow was silently accepted");}
        catch(IllegalStateException ex){assertEquals("queue_full_repair_required",ex.getMessage());}
        reopen();
        assertHealthy();
        assertEquals(2000,queue.snapshot().pending);
        assertEquals(2001,queue.snapshot().nextSequence);
        assertEquals(0,queue.snapshot().confirmed);
        assertEquals(2000,queue.snapshot().unresolved);
    }
    @Test public void corruptedLogicalSequenceIsRejectedEvenIfPhysicalIntegrityCheckPasses(){
        queue.append(event(1),time(1),false);
        queue.getWritableDatabase().execSQL("UPDATE stream_state SET next_seq=99 WHERE id=1");
        assertHealthy(); // Physical SQLite integrity is not playback integrity.
        try {queue.snapshot();fail("logical gap not detected");}
        catch(IllegalStateException ex){assertEquals("queue_gap_repair_required",ex.getMessage());}
        assertEquals(1,number("SELECT COUNT(*) FROM pending"));
        assertEquals(99,number("SELECT next_seq FROM stream_state"));
    }
    @Test public void pendingCannotBecomeSentWithoutClockOrNetworkAtCapacity(){
        SQLiteDatabase db=queue.getWritableDatabase();
        db.beginTransaction();
        try {
            for(int i=1;i<=1999;i++){
                db.execSQL("INSERT INTO pending(seq,event_id,media,completed,seconds,boot_id,elapsed_ms) VALUES(?,?,?,?,?,?,?)",
                    new Object[]{i,event(i).eventId,"advert-1",1,15,BOOT,i});
            }
            db.execSQL("UPDATE stream_state SET next_seq=2000 WHERE id=1");
            db.setTransactionSuccessful();
        }finally{db.endTransaction();}
        queue.append(event(2000),time(2000),false);
        assertTrue(queue.prepareBatch(false,50).isEmpty());
        assertTrue(queue.prepareBatch(true,50).isEmpty());
        assertEquals(0,queue.snapshot().sentThrough);
        assertEquals(0,queue.snapshot().confirmed);
        assertEquals(2000,queue.snapshot().pending);
    }
}
