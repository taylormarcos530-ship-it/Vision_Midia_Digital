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
import java.util.Locale;
import java.util.TimeZone;

import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=28,manifest=Config.NONE)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
public final class UnresolvedAuditQueueTest {
    private static final String DB="vision_v2_sequence_qa_only.db";
    private Context ctx;
    private SequenceStore queue;
    private UnresolvedAuditQueue audit;
    @Before public void setup(){
        ctx= ApplicationProvider.getApplicationContext();
        ctx.deleteDatabase(DB);
        queue=new SequenceStore(ctx);
        queue.provision("tv-audit-qa","stream-audit-qa",true);
        audit=new UnresolvedAuditQueue(queue);
        audit.ensureSchema();
    }
    @After public void clean(){if(queue!=null)queue.close();ctx.deleteDatabase(DB);}
    private SequenceStore.Sample sample(String boot,long ms) {return new SequenceStore.Sample(boot,ms);}
    private SequenceStore.Playback event(int i){
        return new SequenceStore.Playback(String.format(Locale.US,"proof-%08d",i),"media-1",true,15);
    }
    private void reboot(){
        queue.close();queue=new SequenceStore(ctx);
        audit=new UnresolvedAuditQueue(queue);
        audit.ensureSchema();
    }
    private long utc(String text){
        try{
            SimpleDateFormat f=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'",Locale.US);
            f.setTimeZone(TimeZone.getTimeZone("UTC"));f.setLenient(false);
            return f.parse(text).getTime();
        }catch(Exception e){throw new AssertionError(e);}
    }
    private int sqlCount(String table){
        try(Cursor c=queue.getReadableDatabase().rawQuery("SELECT count(*) FROM "+table,null)){
            assertTrue(c.moveToFirst());return c.getInt(0);
        }
    }
    private String firstAction(){
        try(Cursor c=queue.getReadableDatabase().rawQuery(
            "SELECT action FROM qa_review_journal ORDER BY id LIMIT 1",null)){
            assertTrue(c.moveToFirst());return c.getString(0);
        }
    }
    @Test public void stageUnknownPreservesOriginalAndNeverInventsTime(){
        queue.append(event(1),sample("boot-a-001",1000),false);
        assertEquals(1,audit.stageUnknown());
        assertEquals(1,audit.originalCount());
        assertEquals(1,audit.journalCount());
        assertEquals("STAGED_UNVERIFIED",firstAction());
        assertEquals(1,queue.snapshot().unresolved);
        assertTrue(queue.prepareBatch(true,50).isEmpty());
        reboot();
        assertEquals(1,audit.originalCount());
        assertEquals(1,queue.snapshot().pending);
        assertEquals(1,queue.snapshot().unresolved);
    }
    @Test public void stagingIsIdempotentAfterMultipleReboots(){
        queue.append(event(1),sample("boot-a-001",1000),false);
        queue.append(event(2),sample("boot-a-001",2000),false);
        assertEquals(2,audit.stageUnknown());
        reboot();
        assertEquals(0,audit.stageUnknown());
        assertEquals(2,audit.originalCount());
        assertEquals(2,audit.journalCount());
        assertEquals(0,audit.verifiedCount());
    }
    @Test public void reviewerCanDocumentUnverifiableOldBootWithoutClockOverride(){
        queue.append(event(1),sample("boot-a-001",1000),false);
        audit.stageUnknown();
        reboot();
        queue.recordServerTime(sample("boot-b-002",1000),utc("2026-11-01T15:00:00Z"),true);
        audit.noteReview(1,"operator_qa","PREVIOUS_BOOT_UNVERIFIABLE","review-case-00001");
        assertEquals(2,audit.journalCount());
        assertEquals(0,audit.verifiedCount());
        assertEquals(1,queue.snapshot().unresolved);
        assertEquals(1,queue.snapshot().pending);
        assertTrue(queue.prepareBatch(true,50).isEmpty());
        try {audit.markTimestampVerified(1,"trusted-00001",true);fail("unverifiable receipt was accepted");}
        catch(IllegalStateException expected){assertEquals("clock_still_unverified",expected.getMessage());}
    }
    @Test public void validSameBootAnchorIsTrackedButOriginalProofRemainsImmutable(){
        queue.append(event(1),sample("boot-a-001",1000),false);
        audit.stageUnknown();
        assertEquals(1,queue.recordServerTime(sample("boot-a-001",11000),
            utc("2026-10-31T15:00:00Z"),true));
        try {audit.markTimestampVerified(1,"trusted-00001",false);fail("unverified evidence accepted");}
        catch(SecurityException expected){assertEquals("trusted_evidence_required",expected.getMessage());}
        audit.markTimestampVerified(1,"trusted-00001",true);
        assertEquals(1,audit.originalCount());
        assertEquals(2,audit.journalCount());
        assertEquals(1,audit.verifiedCount());
        assertEquals("2026-10-31T14:59:50.000Z",queue.prepareBatch(true,50).get(0).playedAt);
        reboot();
        assertEquals(1,audit.originalCount());
        assertEquals(1,audit.verifiedCount());
    }
    @Test public void auditProofAndReviewAreAppendOnly(){
        queue.append(event(1),sample("boot-a-001",1000),false);audit.stageUnknown();
        SQLiteDatabase db=queue.getWritableDatabase();
        try {
            db.execSQL("DELETE FROM qa_original_proof WHERE seq=1");
            fail("proof delete allowed");
        }catch(SQLiteException e){assertTrue(e.toString().contains("proof_immutable"));}
        try {
            db.execSQL("UPDATE qa_review_journal SET action='VERIFIED_SAME_BOOT_TIME' WHERE seq=1");
            fail("audit history rewrite allowed");
        }catch(SQLiteException e){assertTrue(e.toString().contains("journal_immutable"));}
        assertEquals(1,audit.originalCount());
        assertEquals("STAGED_UNVERIFIED",firstAction());
    }
    @Test public void tamperedPendingReceiptFailsReviewAndNeverMarkedVerified(){
        queue.append(event(1),sample("boot-a-001",1000),false);audit.stageUnknown();
        queue.getWritableDatabase().execSQL("UPDATE pending SET seconds=99 WHERE seq=1");
        try {
            audit.noteReview(1,"operator_qa","WAITING_FOR_TRUSTED_TIME","review-case-00001");
            fail("tampered event accepted");
        }catch(IllegalStateException expected){
            assertEquals("audit_proof_mismatch_repair_required",expected.getMessage());
        }
        assertEquals(1,audit.journalCount());
        assertEquals(0,audit.verifiedCount());
        assertTrue(queue.prepareBatch(true,50).isEmpty());
    }
    @Test public void auditStageFailureRollsBackOriginalAndJournalButNotReceipt(){
        queue.append(event(1),sample("boot-a-001",1000),false);
        SQLiteDatabase db=queue.getWritableDatabase();
        db.execSQL("CREATE TRIGGER qa_abort_review BEFORE INSERT ON qa_review_journal "+
            "BEGIN SELECT RAISE(ABORT,'audit_storage_unavailable'); END");
        try {
            audit.stageUnknown();
            fail("audit stage partial commit allowed");
        }catch(SQLiteException e){assertTrue(e.toString().contains("audit_storage_unavailable"));}
        reboot();
        assertEquals(0,audit.originalCount());
        assertEquals(0,audit.journalCount());
        assertEquals(1,queue.snapshot().pending);
        assertEquals(1,queue.snapshot().unresolved);
        queue.getWritableDatabase().execSQL("DROP TRIGGER qa_abort_review");
        assertEquals(1,audit.stageUnknown());
        assertEquals(1,audit.originalCount());
    }
    @Test public void auditDoesNotAcceptUnstagedOrBadReview(){
        queue.append(event(1),sample("boot-a-001",1000),false);
        try {audit.noteReview(1,"operator_qa","WAITING_FOR_TRUSTED_TIME","review-case-00001");
            fail("unstaged accepted");
        }catch(IllegalStateException e){assertEquals("audit_proof_mismatch_repair_required",e.getMessage());}
        audit.stageUnknown();
        try {audit.noteReview(1,"bad","INVENT_TIMESTAMP","review-case-00001");
            fail("invent timestamp allowed");
        }catch(IllegalArgumentException expected){assertEquals("invalid_audit_review",expected.getMessage());}
        assertEquals(1,audit.journalCount());
        assertEquals(1,queue.snapshot().unresolved);
    }
}
