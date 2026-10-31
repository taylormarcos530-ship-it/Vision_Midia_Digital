package br.com.visionmidia.v2qa;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

/**
 * QA ONLY: append-only audit of playback whose clock could not be verified.
 * Never fabricates time, never deletes or reorders receipts, never changes ACK.
 * Reviewer's identity and trusted-evidence flag are TEST SEAMS, not auth.
 */
public final class UnresolvedAuditQueue {
    private final SequenceStore store;
    public UnresolvedAuditQueue(SequenceStore store) {this.store=store;}

    public void ensureSchema() {
        SQLiteDatabase db=store.getWritableDatabase();
        db.execSQL("CREATE TABLE IF NOT EXISTS qa_original_proof ("+
            "seq INTEGER PRIMARY KEY, stream TEXT NOT NULL, event_id TEXT NOT NULL,"+
            "media TEXT NOT NULL, boot_id TEXT NOT NULL, elapsed_ms INTEGER NOT NULL,"+
            "completed INTEGER NOT NULL, seconds REAL NOT NULL, proof_sha256 TEXT NOT NULL)");
        db.execSQL("CREATE TABLE IF NOT EXISTS qa_review_journal ("+
            "id INTEGER PRIMARY KEY AUTOINCREMENT, seq INTEGER NOT NULL REFERENCES qa_original_proof(seq),"+
            "action TEXT NOT NULL, reviewer TEXT NOT NULL, evidence_ref TEXT NOT NULL)");
        db.execSQL("CREATE TRIGGER IF NOT EXISTS qa_original_no_update BEFORE UPDATE ON qa_original_proof"+
            " BEGIN SELECT RAISE(ABORT,'proof_immutable'); END");
        db.execSQL("CREATE TRIGGER IF NOT EXISTS qa_original_no_delete BEFORE DELETE ON qa_original_proof"+
            " BEGIN SELECT RAISE(ABORT,'proof_immutable'); END");
        db.execSQL("CREATE TRIGGER IF NOT EXISTS qa_journal_no_update BEFORE UPDATE ON qa_review_journal"+
            " BEGIN SELECT RAISE(ABORT,'journal_immutable'); END");
        db.execSQL("CREATE TRIGGER IF NOT EXISTS qa_journal_no_delete BEFORE DELETE ON qa_review_journal"+
            " BEGIN SELECT RAISE(ABORT,'journal_immutable'); END");
    }
    private static String sha(String... values) {
        try {
            MessageDigest d=MessageDigest.getInstance("SHA-256");
            for(String value:values) {
                byte[] bytes=value.getBytes(StandardCharsets.UTF_8);
                byte[] size= new byte[] {
                    (byte)(bytes.length>>>24),(byte)(bytes.length>>>16),
                    (byte)(bytes.length>>>8),(byte)(bytes.length)
                };
                d.update(size);d.update(bytes);
            }
            byte[] raw=d.digest();
            StringBuilder sb=new StringBuilder();
            for(byte b:raw)sb.append(String.format(Locale.ROOT,"%02x",b&255));
            return sb.toString();
        }catch(Exception e){throw new IllegalStateException("sha256_unavailable",e);}
    }
    private static String proofHash(String stream,long seq,String eventId,String media,
                                     String boot,long elapsed,int completed,double seconds) {
        return sha(stream,Long.toString(seq),eventId,media,boot,Long.toString(elapsed),
            Integer.toString(completed),Double.toString(seconds));
    }
    private static String stream(SQLiteDatabase db){
        try(Cursor c=db.rawQuery("SELECT stream FROM stream_state WHERE id=1",null)){
            if(!c.moveToFirst())throw new IllegalStateException("missing_stream");
            return c.getString(0);
        }
    }
    private static String snapshotHash(SQLiteDatabase db,long seq){
        try(Cursor c=db.rawQuery("SELECT proof_sha256 FROM qa_original_proof WHERE seq=?",
                new String[]{Long.toString(seq)})){
            return c.moveToFirst()?c.getString(0):null;
        }
    }
    private static String currentHash(SQLiteDatabase db,long seq,String stream){
        try(Cursor c=db.rawQuery("SELECT event_id,media,boot_id,elapsed_ms,completed,seconds FROM pending WHERE seq=?",
                new String[]{Long.toString(seq)})){
            if(!c.moveToFirst())return null;
            return proofHash(stream,seq,c.getString(0),c.getString(1),
                c.getString(2),c.getLong(3),c.getInt(4),c.getDouble(5));
        }
    }
    private static void append(SQLiteDatabase db,long seq,String action,String reviewer,String evidence){
        ContentValues v=new ContentValues();
        v.put("seq",seq);v.put("action",action);v.put("reviewer",reviewer);v.put("evidence_ref",evidence);
        db.insertOrThrow("qa_review_journal",null,v);
    }
    /** Snapshot currently unresolved proofs and create one STAGED audit entry per proof.
     * Original pending receipt is NOT changed, and no timestamp is added.
     */
    public int stageUnknown() {
        SQLiteDatabase db=store.getWritableDatabase();
        db.beginTransaction();
        try {
            String s=stream(db);
            int staged=0;
            try(Cursor c=db.rawQuery(
                    "SELECT seq,event_id,media,boot_id,elapsed_ms,completed,seconds "+
                    "FROM pending WHERE utc_ms IS NULL ORDER BY seq",null)){
                while(c.moveToNext()){
                    long seq=c.getLong(0);
                    String h=proofHash(s,seq,c.getString(1),c.getString(2),c.getString(3),
                        c.getLong(4),c.getInt(5),c.getDouble(6));
                    String old=snapshotHash(db,seq);
                    if(old!=null){
                        if(!old.equals(h))throw new IllegalStateException("audit_proof_mismatch_repair_required");
                        continue;
                    }
                    ContentValues v=new ContentValues();
                    v.put("seq",seq);v.put("stream",s);v.put("event_id",c.getString(1));
                    v.put("media",c.getString(2));v.put("boot_id",c.getString(3));
                    v.put("elapsed_ms",c.getLong(4));v.put("completed",c.getInt(5));
                    v.put("seconds",c.getDouble(6));v.put("proof_sha256",h);
                    db.insertOrThrow("qa_original_proof",null,v);
                    append(db,seq,"STAGED_UNVERIFIED","SYSTEM","NO_TRUSTED_TIME");
                    staged++;
                }
            }
            db.setTransactionSuccessful();return staged;
        }finally{db.endTransaction();}
    }
    /**
     * Manual notes never authorize a timestamp or an ACK; keep original evidence.
     * No network, no server credentials and no bypass of strict FIFO.
     */
    public void noteReview(long seq,String reviewer,String decision,String evidence) {
        if(reviewer==null || !reviewer.matches("[a-zA-Z0-9_-]{3,80}") ||
            evidence==null || evidence.length()<8 || evidence.length()>180 ||
            !(decision.equals("PREVIOUS_BOOT_UNVERIFIABLE") ||
              decision.equals("WAITING_FOR_TRUSTED_TIME") ||
              decision.equals("DOCUMENTED_FOR_REVIEW")))
            throw new IllegalArgumentException("invalid_audit_review");
        SQLiteDatabase db=store.getWritableDatabase();
        db.beginTransaction();
        try {
            String prior=snapshotHash(db,seq);
            String present=currentHash(db,seq,stream(db));
            if(prior==null || present==null || !prior.equals(present))
                throw new IllegalStateException("audit_proof_mismatch_repair_required");
            append(db,seq,decision,reviewer,evidence);
            db.setTransactionSuccessful();
        }finally{db.endTransaction();}
    }
    /**
     * Only for timestamps ALREADY repaired by authenticated same-boot server anchor.
     * A synthetic QA flag is used here; production must validate proof on server.
     * An older boot with no time remains unresolved, not 'approved'.
     */
    public void markTimestampVerified(long seq,String evidence,boolean authenticatedProof) {
        if(!authenticatedProof)throw new SecurityException("trusted_evidence_required");
        if(evidence==null || !evidence.matches("[a-zA-Z0-9_-]{8,128}"))
            throw new IllegalArgumentException("invalid_evidence_reference");
        SQLiteDatabase db=store.getWritableDatabase();
        db.beginTransaction();
        try {
            String prior=snapshotHash(db,seq);
            if(prior==null || !prior.equals(currentHash(db,seq,stream(db))))
                throw new IllegalStateException("audit_proof_mismatch_repair_required");
            try(Cursor c=db.rawQuery("SELECT utc_ms,played_day FROM pending WHERE seq=?",
                    new String[]{Long.toString(seq)})){
                if(!c.moveToFirst() || c.isNull(0) || c.getString(1)==null)
                    throw new IllegalStateException("clock_still_unverified");
            }
            append(db,seq,"VERIFIED_SAME_BOOT_TIME","SERVER_QA",evidence);
            db.setTransactionSuccessful();
        }finally{db.endTransaction();}
    }
    public int originalCount() {
        try(Cursor c=store.getReadableDatabase().rawQuery("SELECT count(*) FROM qa_original_proof",null)){
            if(!c.moveToFirst())throw new IllegalStateException("no_audit_schema");
            return c.getInt(0);
        }
    }
    public int journalCount() {
        try(Cursor c=store.getReadableDatabase().rawQuery("SELECT count(*) FROM qa_review_journal",null)){
            if(!c.moveToFirst())throw new IllegalStateException("no_audit_schema");
            return c.getInt(0);
        }
    }
    public int verifiedCount() {
        try(Cursor c=store.getReadableDatabase().rawQuery(
             "SELECT count(*) FROM qa_review_journal WHERE action='VERIFIED_SAME_BOOT_TIME'",null)){
            if(!c.moveToFirst())throw new IllegalStateException("no_audit_schema");
            return c.getInt(0);
        }
    }
}
