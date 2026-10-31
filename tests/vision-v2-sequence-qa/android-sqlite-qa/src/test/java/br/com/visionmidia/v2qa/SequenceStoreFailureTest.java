package br.com.visionmidia.v2qa;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteException;
import androidx.test.core.app.ApplicationProvider;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.SQLiteMode;

import java.text.SimpleDateFormat;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

import static org.junit.Assert.*;

/**
 * QA ONLY: real native SQLite transactions in Robolectric.
 * SQL triggers inject deterministic write failures at critical statements.
 * These tests DO NOT fill physical flash and DO NOT cut electrical power.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, manifest = Config.NONE)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
public final class SequenceStoreFailureTest {
    private static final String DB = "vision_v2_sequence_qa_only.db";
    private static final String BOOT_A = "qa-boot-0001";
    private static final String BOOT_B = "qa-boot-0002";
    private Context context;
    private SequenceStore queue;

    @Before public void setup() {
        context = ApplicationProvider.getApplicationContext();
        context.deleteDatabase(DB);
        queue = new SequenceStore(context);
        queue.provision("tv-qa-fault", "stream-qa-fault", true);
    }
    @After public void tearDown() {
        if (queue != null) queue.close();
        context.deleteDatabase(DB);
    }
    private SequenceStore.Playback event(int n) {
        return new SequenceStore.Playback(String.format(Locale.US, "receipt-%08d", n),
                "ad-test", true, 15);
    }
    private SequenceStore.Sample sample(String boot, long elapsed) {
        return new SequenceStore.Sample(boot, elapsed);
    }
    private long utc(String iso) {
        try {
            SimpleDateFormat fmt=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
            fmt.setLenient(false);
            fmt.setTimeZone(TimeZone.getTimeZone("UTC"));
            return fmt.parse(iso).getTime();
        } catch (Exception ex) { throw new AssertionError(ex); }
    }
    private void trust(String boot, long elapsed, String iso) {
        queue.recordServerTime(sample(boot, elapsed), utc(iso), true);
    }
    private void reopen() {
        queue.close();
        queue=new SequenceStore(context);
    }
    private long scalar(String query) {
        try(Cursor c=queue.getReadableDatabase().rawQuery(query,null)) {
            assertTrue(c.moveToFirst());
            return c.getLong(0);
        }
    }
    private void failure(Runnable action, String expected) {
        try { action.run(); fail("Expected failure: "+expected); }
        catch (SQLiteException e) { assertTrue("actual: "+e, e.toString().contains(expected)); }
    }
    private void trigger(String name, String timing, String table, String sqlMessage) {
        queue.getWritableDatabase().execSQL("CREATE TRIGGER "+name+" BEFORE "+timing+" ON "+table+
                " BEGIN SELECT RAISE(ABORT, '"+sqlMessage+"'); END");
    }
    private void drop(String name) {
        queue.getWritableDatabase().execSQL("DROP TRIGGER IF EXISTS "+name);
    }

    @Test public void injectedStorageFailureAtInsertKeepsCounterUnchanged() {
        trigger("qa_fail_insert", "INSERT", "pending", "qa_injected_storage_failure");
        failure(()->queue.append(event(1),sample(BOOT_A,500),false), "qa_injected_storage_failure");
        reopen();
        assertEquals(0,queue.snapshot().pending);
        assertEquals(1,queue.snapshot().nextSequence);
        drop("qa_fail_insert");
        assertEquals(1,queue.append(event(1),sample(BOOT_A,500),false));
    }

    @Test public void injectedStorageFailureAfterInsertBeforeCounterRollsBackBoth() {
        trigger("qa_fail_counter", "UPDATE OF next_seq", "stream_state", "qa_injected_storage_failure");
        failure(()->queue.append(event(1),sample(BOOT_A,500),false), "qa_injected_storage_failure");
        reopen();
        assertEquals(0,queue.snapshot().pending);
        assertEquals(1,queue.snapshot().nextSequence);
        assertEquals(0,scalar("SELECT count(*) FROM pending"));
        drop("qa_fail_counter");
        assertEquals(1,queue.append(event(1),sample(BOOT_A,500),false));
    }

    @Test public void powerLossBeforeCommitSimulationPreservesPreviousRecords() {
        queue.append(event(1),sample(BOOT_A,100),false);
        try { queue.append(event(2),sample(BOOT_A,200),true); fail("missing simulated failure"); }
        catch (IllegalStateException ex) { assertTrue(ex.getMessage().contains("simulated_power_loss")); }
        reopen();
        assertEquals(1,queue.snapshot().pending);
        assertEquals(2,queue.snapshot().nextSequence);
        assertEquals(2,queue.append(event(2),sample(BOOT_A,200),false));
    }

    @Test public void processRestartAfterCommitBeforeReturnDoesNotDuplicatePendingEvent() {
        queue.append(event(1),sample(BOOT_A,100),false);
        // Caller loses the result of the successful commit; app process restarts.
        reopen();
        assertEquals(1,queue.append(event(1),sample(BOOT_A,100),false));
        assertEquals(1,queue.snapshot().pending);
        assertEquals(2,queue.snapshot().nextSequence);
    }

    @Test public void ackStorageFailureAfterDeleteRollsBackReceiptDeletion() {
        trust(BOOT_A,1000,"2026-10-31T15:00:00Z");
        queue.append(event(1),sample(BOOT_A,2000),false);
        queue.append(event(2),sample(BOOT_A,3000),false);
        assertEquals(2,queue.prepareBatch(true,50).size());
        trigger("qa_fail_ack", "UPDATE OF confirmed", "stream_state", "qa_injected_ack_failure");
        failure(()->queue.acknowledge(2,true),"qa_injected_ack_failure");
        reopen();
        assertEquals(2,queue.snapshot().pending);
        assertEquals(0,queue.snapshot().confirmed);
        assertEquals(2,queue.snapshot().sentThrough);
        drop("qa_fail_ack");
        queue.acknowledge(2,true);
        assertEquals(0,queue.snapshot().pending);
    }

    @Test public void ackFailureMustNotAdvanceWatermarkOrDestroySentReceipt() {
        trust(BOOT_A,1000,"2026-10-31T15:00:00Z");
        queue.append(event(1),sample(BOOT_A,1100),false);
        queue.prepareBatch(true,50);
        trigger("qa_fail_ack", "UPDATE OF confirmed", "stream_state", "qa_injected_ack_failure");
        failure(()->queue.acknowledge(1,true),"qa_injected_ack_failure");
        assertEquals(1,queue.snapshot().pending);
        assertEquals(0,queue.snapshot().confirmed);
        drop("qa_fail_ack");
        assertEquals(1,queue.prepareBatch(true,50).get(0).sequence);
    }

    @Test public void clockBackfillFailureRollsBackBothAnchorAndTimestamps() {
        queue.append(event(1),sample(BOOT_A,1000),false);
        trigger("qa_fail_backfill", "UPDATE OF utc_ms", "pending", "qa_injected_backfill_failure");
        failure(()->queue.recordServerTime(sample(BOOT_A,5000),utc("2026-10-31T15:00:00Z"),true),
                "qa_injected_backfill_failure");
        reopen();
        assertEquals(1,queue.snapshot().unresolved);
        assertEquals(1,scalar("SELECT count(*) FROM stream_state WHERE anchor_boot IS NULL"));
        drop("qa_fail_backfill");
        assertEquals(1,queue.recordServerTime(sample(BOOT_A,5000),utc("2026-10-31T15:00:00Z"),true));
        assertEquals(0,queue.snapshot().unresolved);
    }

    @Test public void recoveryWithinSameBootAfterProcessRestartUsesMonotonicSample() {
        queue.append(event(1),sample(BOOT_A,2000),false);
        reopen();
        assertEquals(1,queue.snapshot().unresolved);
        assertEquals(1,queue.recordServerTime(sample(BOOT_A,12000),utc("2026-10-31T15:00:00Z"),true));
        assertEquals("2026-10-31T14:59:50.000Z",queue.prepareBatch(true,50).get(0).playedAt);
    }

    @Test public void rebootBeforeClockSyncCannotInventDateForPreviousBoot() {
        queue.append(event(1),sample(BOOT_A,1000),false);
        reopen(); // first process gone; TV boot B
        assertEquals(0,queue.recordServerTime(sample(BOOT_B,500),utc("2026-11-01T15:00:00Z"),true));
        queue.append(event(2),sample(BOOT_B,2500),false);
        reopen();
        assertEquals(2,queue.snapshot().pending);
        assertEquals(1,queue.snapshot().unresolved);
        assertTrue(queue.prepareBatch(true,50).isEmpty());
        assertEquals(0,queue.snapshot().sentThrough);
        assertEquals(1,scalar("SELECT count(*) FROM pending WHERE seq=1 AND utc_ms IS NULL AND boot_id='qa-boot-0001'"));
        assertEquals(1,scalar("SELECT count(*) FROM pending WHERE seq=2 AND utc_ms IS NOT NULL AND boot_id='qa-boot-0002'"));
    }

    @Test public void repeatedRebootsDoNotOverwriteUnknownOldReceipt() {
        queue.append(event(1),sample(BOOT_A,1000),false);
        trust(BOOT_B,1000,"2026-11-01T15:00:00Z");
        reopen();
        assertEquals(0,queue.recordServerTime(sample("qa-boot-0003",1000),utc("2026-11-02T15:00:00Z"),true));
        reopen();
        assertEquals(1,queue.snapshot().pending);
        assertEquals(1,queue.snapshot().unresolved);
        assertEquals(1,queue.snapshot().nextSequence-1);
    }

    @Test public void priorTrustedTimestampSurvivesRebootAndCanBeSentAfterAuth() {
        trust(BOOT_A,1000,"2026-10-31T15:00:00Z");
        queue.append(event(1),sample(BOOT_A,2000),false);
        reopen();
        trust(BOOT_B,1000,"2026-11-01T15:00:00Z");
        List<SequenceStore.Event> batch=queue.prepareBatch(true,50);
        assertEquals(1,batch.size());
        assertEquals(1,batch.get(0).sequence);
        assertEquals("2026-10-31T15:00:01.000Z",batch.get(0).playedAt);
    }

    @Test public void invalid1970AfterRebootLeavesOriginalReceiptAndQueueUnchanged() {
        queue.append(event(1),sample(BOOT_A,1000),false);
        reopen();
        try {queue.recordServerTime(sample(BOOT_B,2000),utc("1970-01-01T00:00:00Z"),true);
            fail("should reject untrusted RTC");}
        catch(IllegalArgumentException expected){assertEquals("untrusted_time",expected.getMessage());}
        assertEquals(1,queue.snapshot().unresolved);
        assertEquals(1,queue.snapshot().pending);
        assertEquals(1,queue.snapshot().nextSequence-1);
    }

    @Test public void injectedFailureDuringProvisionCannotCreatePartialIdentity() {
        queue.close();
        context.deleteDatabase(DB);
        queue=new SequenceStore(context);
        trigger("qa_fail_provision", "INSERT", "stream_state", "qa_injected_provision_failure");
        failure(()->queue.provision("tv-qa-fault","stream-qa-fault",true),"qa_injected_provision_failure");
        reopen();
        assertEquals(0,scalar("SELECT count(*) FROM stream_state"));
        drop("qa_fail_provision");
        queue.provision("tv-qa-fault","stream-qa-fault",true);
        assertEquals(1,queue.snapshot().nextSequence);
    }

    @Test public void corruptedQueueNeverResetsNextSequenceAutomatically() {
        queue.append(event(1),sample(BOOT_A,1000),false);
        queue.getWritableDatabase().execSQL("DELETE FROM pending WHERE seq=1");
        reopen();
        try {queue.append(event(2),sample(BOOT_B,1000),false);fail("should block corruption");}
        catch(IllegalStateException expected){assertTrue(expected.getMessage().contains("queue_gap_repair_required"));}
        assertEquals(2,scalar("SELECT next_seq FROM stream_state WHERE id=1"));
        assertEquals(0,scalar("SELECT count(*) FROM pending"));
    }

    @Test public void noNetworkAndUnknownClockDoesNotMarkAnyRecordSent() {
        queue.append(event(1),sample(BOOT_A,1000),false);
        assertEquals(0,queue.prepareBatch(false,50).size());
        assertEquals(0,queue.prepareBatch(true,50).size());
        assertEquals(0,queue.snapshot().sentThrough);
        assertEquals(0,queue.snapshot().confirmed);
        assertEquals(1,queue.snapshot().pending);
    }
}
