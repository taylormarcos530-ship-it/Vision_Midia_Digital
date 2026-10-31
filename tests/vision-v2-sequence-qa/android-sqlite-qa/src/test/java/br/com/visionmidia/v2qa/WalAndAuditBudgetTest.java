package br.com.visionmidia.v2qa;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import androidx.test.core.app.ApplicationProvider;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.SQLiteMode;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=28,manifest=Config.NONE)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
public class WalAndAuditBudgetTest {
    private Context context;
    private SegmentedOfflineQueue store;
    private static final String BOOT="wal-seven-boot-01";
    @Before public void before(){
        context=ApplicationProvider.getApplicationContext();
        context.deleteDatabase(SegmentedOfflineQueue.DB_NAME);
        store=new SegmentedOfflineQueue(context);
        store.provision("tv-budget-qa","stream-budget-qa",true);
    }
    @After public void after(){
        if(store!=null)store.close();
        context.deleteDatabase(SegmentedOfflineQueue.DB_NAME);
    }
    private List<SegmentedOfflineQueue.Entry> block(int start,int count){
        ArrayList<SegmentedOfflineQueue.Entry> list=new ArrayList<>(count);
        for(int i=start;i<start+count;i++)
            list.add(new SegmentedOfflineQueue.Entry(
                String.format(Locale.US,"budget-%08d",i),"ad-"+(i%10),BOOT,
                i*15000L,15,true));
        return list;
    }
    private void reopen(){store.close();store=new SegmentedOfflineQueue(context);}
    private long count(String table){
        try(Cursor c=store.getReadableDatabase().rawQuery("SELECT count(*) FROM "+table,null)){
            assertTrue(c.moveToFirst());return c.getLong(0);
        }
    }
    private long fileBytes(String suffix){
        File path=context.getDatabasePath(SegmentedOfflineQueue.DB_NAME);
        File f=new File(path.getPath()+suffix);
        return f.exists()?f.length():0;
    }
    private void expect(String code,Runnable run){
        try{run.run();fail("expected "+code);}catch(RuntimeException e){
            assertTrue("Actual "+e,e.toString().contains(code));
        }
    }

    @Test public void checkpointKeepsWalBelowHardBudgetDuringSevenDayLoad() {
        int n=40320;long peak=0;
        for(int start=1;start<=n;start+=1024){
            store.appendBatch(block(start,Math.min(1024,n-start+1)));
            peak=Math.max(peak,store.walBytes());
        }
        assertEquals(40320,store.pending());
        assertTrue("missing checkpoint in WAL native",store.checkpointCount()>0);
        assertTrue("WAL exceeded hard cap before next write: "+peak,
            peak < SegmentedOfflineQueue.WAL_HARD_BYTES);
        long after=store.enforceWalBudget();
        assertTrue(after<=SegmentedOfflineQueue.WAL_SOFT_BYTES);
        System.out.println("V2_WAL_BUDGET before_reopen_wal="+store.walBytes()+
           " peak_wal="+peak+" checkpoint_count="+store.checkpointCount()+
           " main_db="+fileBytes("")+" shm="+fileBytes("-shm"));
        assertEquals("ok",store.integrity());
        store.verifyLogical();
        reopen();
        assertEquals(40320,store.pending());
        assertEquals(40,store.segments());
        assertEquals("ok",store.integrity());
        store.verifyLogical();
        System.out.println("V2_WAL_RECOVERY after_reopen_wal="+store.walBytes()+
            " main_db="+fileBytes("")+" shm="+fileBytes("-shm"));
    }

    @Test public void auditStagesBoundedBatchesAndStopsBeforeUnboundedGrowth(){
        final int n=5000;
        for(int i=1;i<=n;i+=1024)store.appendBatch(block(i,Math.min(1024,n-i+1)));
        assertEquals(n,store.pending());
        int staged=0;int runs=0;
        while(staged<SegmentedOfflineQueue.MAX_AUDIT_PROOFS){
            int got=store.stageUnresolved();
            assertTrue("staging stuck",got>0);
            assertTrue(got<=SegmentedOfflineQueue.AUDIT_STAGE_BATCH);
            staged+=got;runs++;
        }
        assertEquals(4096,staged);
        assertEquals(4096,store.auditCount());
        assertEquals(4096,store.auditReviews());
        assertEquals(5000,store.pending());
        assertEquals(5000,store.unresolved());
        expect("audit_capacity_export_required",()->store.stageUnresolved());
        store.verifyLogical();
        assertEquals("ok",store.integrity());
        System.out.println("V2_AUDIT_QUOTA staged="+staged+" staging_calls="+runs+
            " rows="+store.pending()+" proof_rows="+store.auditCount()+
            " review_rows="+store.auditReviews()+" db_pages_bytes="+store.pageBytes()+
            " wal="+store.walBytes());
        reopen();
        assertEquals(4096,store.auditCount());
        assertEquals(5000,store.pending());
        assertEquals(5000,store.unresolved());
        expect("audit_capacity_export_required",()->store.stageUnresolved());
    }

    @Test public void reviewCapacityRejectsExtraButDoesNotModifyProofOrQueue(){
        store.appendBatch(block(1,1));store.stageUnresolved();
        SQLiteDatabase db=store.getWritableDatabase();
        db.beginTransaction();
        try {
            for(int i=1;i<SegmentedOfflineQueue.MAX_AUDIT_REVIEWS;i++){
                db.execSQL("INSERT INTO audit_reviews(seq,code,evidence) VALUES(1,'QA_SEED','fixture')");
            }
            db.setTransactionSuccessful();
        }finally{db.endTransaction();}
        assertEquals(SegmentedOfflineQueue.MAX_AUDIT_REVIEWS,store.auditReviews());
        expect("audit_capacity_export_required",()->store.annotateUnverifiable(1,"case-proof-1234"));
        assertEquals(1,store.auditCount());
        assertEquals(1,store.pending());
        assertEquals(SegmentedOfflineQueue.MAX_AUDIT_REVIEWS,store.auditReviews());
        assertEquals(1,store.unresolved());
        System.out.println("V2_AUDIT_REVIEW_QUOTA rows="+store.auditReviews()+
            " pending="+store.pending()+" db_pages_bytes="+store.pageBytes());
    }

    @Test public void oldBootWithNoAnchorRemainsPendingAfterRestartAndReview(){
        store.appendBatch(block(1,2));
        assertEquals(2,store.stageUnresolved());
        reopen();
        store.trustedTime("new-boot-verified",1000L,1793620800000L,true);
        store.annotateUnverifiable(1,"manual-case-000001");
        assertEquals(2,store.auditCount());
        assertEquals(3,store.auditReviews());
        assertEquals(2,store.unresolved());
        assertTrue(store.prepare(true,50).isEmpty());
        assertEquals(0,store.sent());
        assertEquals(0,store.acknowledged());
        reopen();
        assertEquals(2,store.pending());
        assertEquals("ok",store.integrity());
        store.verifyLogical();
    }

    @Test public void midAuditWriteFaultRollsBackWithoutLosingUnstagedReceipts(){
        store.appendBatch(block(1,3));
        SQLiteDatabase db=store.getWritableDatabase();
        db.execSQL("CREATE TRIGGER qa_audit_fault BEFORE INSERT ON audit_reviews "+
           "WHEN NEW.seq=2 BEGIN SELECT RAISE(ABORT,'qa_audit_io_failure');END");
        expect("qa_audit_io_failure",()->store.stageUnresolved());
        assertEquals(0,store.auditCount());
        assertEquals(0,store.auditReviews());
        assertEquals(3,store.pending());
        db.execSQL("DROP TRIGGER qa_audit_fault");
        assertEquals(3,store.stageUnresolved());
        reopen();
        assertEquals(3,store.auditCount());
        assertEquals(3,store.auditReviews());
        assertEquals(3,store.pending());
        store.verifyLogical();
    }
}
