package br.com.visionmidia.v2qa;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteException;
import android.database.sqlite.SQLiteOpenHelper;
import android.database.sqlite.SQLiteStatement;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

/**
 * EXPERIMENTAL QA ONLY: independent SQLite store, no APK/player integration.
 * Logical segments (1024 receipts) keep a stable sequence, rather than one
 * physical SQLite table per segment. The ledger holds only pending receipts.
 * Counters and rows are changed in the same SQLite transaction.
 * Dates are NEVER inferred from an untrusted RTC/1970.
 */
public final class SegmentedOfflineQueue extends SQLiteOpenHelper {
    public static final int SEGMENT_SIZE=1024;
    public static final int MAX_PENDING=50000;             // > 40320 for 7d @15s
    public static final long MAX_DATABASE_BYTES=64L*1024*1024; // per TV, QA limit
    private static final long MIN_UTC=1577836800000L;
    private static final long MAX_UTC=4102444800000L;
    private static final long MAX_MONO_DELTA=30L*86400000;
    public static final String DB_NAME="vision_v2_seven_day_qa_only.db";
    private RuntimeException previousFailure;
    public SegmentedOfflineQueue(Context context) {
        super(context,DB_NAME,null,1);
        setWriteAheadLoggingEnabled(true);
    }
    @Override public void onConfigure(SQLiteDatabase db) {
        super.onConfigure(db);
        db.setForeignKeyConstraintsEnabled(true);
    }
    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE state (id INTEGER PRIMARY KEY CHECK(id=1),"+
          " device TEXT NOT NULL, stream TEXT NOT NULL,"+
          " next_seq INTEGER NOT NULL, ack INTEGER NOT NULL, sent INTEGER NOT NULL,"+
          " pending_count INTEGER NOT NULL,anchor_boot TEXT,anchor_mono INTEGER,anchor_utc INTEGER)");
        db.execSQL("CREATE TABLE segments (bucket INTEGER PRIMARY KEY,first_seq INTEGER NOT NULL,"+
          "last_seq INTEGER NOT NULL,live_count INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE receipts (seq INTEGER PRIMARY KEY, bucket INTEGER NOT NULL,"+
          "event_id TEXT NOT NULL UNIQUE, media TEXT NOT NULL, completed INTEGER NOT NULL,"+
          "seconds REAL NOT NULL, boot TEXT NOT NULL,mono INTEGER NOT NULL,"+
          " utc INTEGER, day TEXT,FOREIGN KEY(bucket) REFERENCES segments(bucket))");
        db.execSQL("CREATE INDEX receipts_unknown ON receipts(seq) WHERE utc IS NULL");
        db.execSQL("CREATE TABLE audit_proofs(seq INTEGER PRIMARY KEY,event_id TEXT NOT NULL,"+
          "media TEXT NOT NULL,completed INTEGER NOT NULL,seconds REAL NOT NULL,"+
          "boot TEXT NOT NULL,mono INTEGER NOT NULL,proof_sha TEXT NOT NULL)");
        db.execSQL("CREATE TABLE audit_reviews(id INTEGER PRIMARY KEY AUTOINCREMENT,"+
          "seq INTEGER NOT NULL,code TEXT NOT NULL,evidence TEXT NOT NULL)");
        db.execSQL("CREATE TRIGGER audit_proof_immutable_update BEFORE UPDATE ON audit_proofs"+
          " BEGIN SELECT RAISE(ABORT,'audit_immutable');END");
        db.execSQL("CREATE TRIGGER audit_proof_immutable_delete BEFORE DELETE ON audit_proofs"+
          " BEGIN SELECT RAISE(ABORT,'audit_immutable');END");
        db.execSQL("CREATE TRIGGER audit_review_immutable_update BEFORE UPDATE ON audit_reviews"+
          " BEGIN SELECT RAISE(ABORT,'audit_immutable');END");
        db.execSQL("CREATE TRIGGER audit_review_immutable_delete BEFORE DELETE ON audit_reviews"+
          " BEGIN SELECT RAISE(ABORT,'audit_immutable');END");
    }
    @Override public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion) {
        throw new IllegalStateException("schema_migration_required");
    }
    @Override public void onOpen(SQLiteDatabase db) {
        super.onOpen(db);
        long pageSize=scalar(db,"PRAGMA page_size");
        long maxPages=MAX_DATABASE_BYTES/pageSize;
        scalar(db,"PRAGMA max_page_count="+maxPages);
    }
    private static long scalar(SQLiteDatabase db,String sql) {
        try(Cursor c=db.rawQuery(sql,null)) {
            if(!c.moveToFirst())throw new IllegalStateException("missing_sql_result");
            return c.getLong(0);
        }
    }
    private static String str(SQLiteDatabase db,String sql) {
        try(Cursor c=db.rawQuery(sql,null)) {
            if(!c.moveToFirst())throw new IllegalStateException("missing_sql_result");
            return c.getString(0);
        }
    }
    private static final class State {
        String device,stream,anchorBoot;
        long next,ack,sent,count,anchorMono,anchorUtc;
    }
    private static State read(SQLiteDatabase db) {
        try(Cursor c=db.rawQuery("SELECT device,stream,next_seq,ack,sent,pending_count,"+
          "anchor_boot,anchor_mono,anchor_utc FROM state WHERE id=1",null)) {
            if(!c.moveToFirst())throw new IllegalStateException("unprovisioned_repair_required");
            State s=new State();
            s.device=c.getString(0);s.stream=c.getString(1);s.next=c.getLong(2);
            s.ack=c.getLong(3);s.sent=c.getLong(4);s.count=c.getLong(5);
            s.anchorBoot=c.getString(6);
            s.anchorMono=c.isNull(7)?-1:c.getLong(7);
            s.anchorUtc=c.isNull(8)?-1:c.getLong(8);
            if(s.next<1 || s.ack<0 || s.ack>s.sent || s.sent>=s.next ||
              s.count<0 || s.count>MAX_PENDING || s.next-s.ack-1!=s.count)
                throw new IllegalStateException("sequence_state_repair_required");
            return s;
        }
    }
    private static void end(SQLiteDatabase db,RuntimeException original) {
        try {db.endTransaction();}
        catch(SQLiteException cleanup) {
            if(original==null)throw cleanup;
            original.addSuppressed(cleanup); // SQLITE_FULL may auto-rollback
        }
    }
    public void provision(String device,String stream,boolean grantedByServer) {
        if(!grantedByServer)throw new SecurityException("server_grant_required");
        if(device==null || !device.matches("[a-zA-Z0-9_-]{3,100}") ||
           stream==null || !stream.matches("[a-zA-Z0-9_-]{3,100}"))
            throw new IllegalArgumentException("invalid_identity");
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        RuntimeException failure=null;
        try{
            if(scalar(db,"SELECT count(*) FROM state")!=0)
                throw new IllegalStateException("existing_stream_cannot_reset");
            db.execSQL("INSERT INTO state(id,device,stream,next_seq,ack,sent,pending_count) VALUES(1,?,?,1,0,0,0)",
              new Object[]{device,stream});
            db.setTransactionSuccessful();
        }catch(RuntimeException ex){failure=ex;throw ex;}
        finally {end(db,failure);}
    }
    public static final class Entry {
        public final String eventId,media,boot;
        public final long mono;
        public final double seconds;
        public final boolean completed;
        public Entry(String eventId,String media,String boot,long mono,double seconds,boolean completed){
            if(eventId==null || !eventId.matches("[A-Za-z0-9_-]{8,120}") ||
               media==null || !media.matches("[A-Za-z0-9_-]{1,120}") ||
               boot==null || !boot.matches("[A-Za-z0-9_-]{8,100}") ||
               mono<0 || !Double.isFinite(seconds) || seconds<0 || seconds>3600)
                throw new IllegalArgumentException("invalid_receipt");
            this.eventId=eventId;this.media=media;this.boot=boot;this.mono=mono;
            this.seconds=seconds;this.completed=completed;
        }
    }
    private static Long trustedUtc(State s,Entry e) {
        if(s.anchorBoot==null || !s.anchorBoot.equals(e.boot))return null;
        long delta=e.mono-s.anchorMono;
        if(Math.abs(delta)>MAX_MONO_DELTA)return null;
        long value=s.anchorUtc+delta;
        return value>=MIN_UTC && value<MAX_UTC?value:null;
    }
    private static String day(long utc) {
        SimpleDateFormat f=new SimpleDateFormat("yyyy-MM-dd",Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("America/Sao_Paulo"));
        return f.format(new Date(utc));
    }
    private static String iso(long utc) {
        SimpleDateFormat f=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date(utc));
    }
    private static String proof(String stream,long seq,String eventId,String media,boolean completed,
                                double seconds,String boot,long mono) {
        try{
            MessageDigest sha=MessageDigest.getInstance("SHA-256");
            String value=stream+"\u001f"+seq+"\u001f"+eventId+"\u001f"+media+"\u001f"+
                completed+"\u001f"+seconds+"\u001f"+boot+"\u001f"+mono;
            byte[] bytes=sha.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder b=new StringBuilder();
            for(byte x:bytes)b.append(String.format(Locale.ROOT,"%02x",x&255));
            return b.toString();
        }catch(Exception ex){throw new IllegalStateException("hash_unavailable",ex);}
    }
    /**
     * Atomic batch (up to 1024 per transaction); returns the final sequence.
     * When full, rejects whole batch rather than silently dropping ads.
     */
    public long appendBatch(List<Entry> batch) {
        if(batch==null || batch.isEmpty() || batch.size()>SEGMENT_SIZE)
            throw new IllegalArgumentException("batch_size");
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        RuntimeException failure=null;
        try{
            State s=read(db);
            if(s.count+batch.size()>MAX_PENDING)
                throw new IllegalStateException("pending_capacity_reached");
            long seq=s.next;
            Map<Long,long[]> affected=new LinkedHashMap<>();
            try(SQLiteStatement insert=db.compileStatement(
              "INSERT INTO receipts(seq,bucket,event_id,media,completed,seconds,boot,mono,utc,day)"+
              " VALUES(?,?,?,?,?,?,?,?,?,?)")) {
                for(Entry e:batch){
                    long bucket=(seq-1)/SEGMENT_SIZE;
                    long[] range=affected.get(bucket);
                    if(range==null){range=new long[]{seq,seq,0};affected.put(bucket,range);}
                    range[1]=seq;range[2]++;
                    insert.clearBindings();
                    insert.bindLong(1,seq);insert.bindLong(2,bucket);
                    insert.bindString(3,e.eventId);insert.bindString(4,e.media);
                    insert.bindLong(5,e.completed?1:0);insert.bindDouble(6,e.seconds);
                    insert.bindString(7,e.boot);insert.bindLong(8,e.mono);
                    Long utc=trustedUtc(s,e);
                    if(utc!=null){insert.bindLong(9,utc);insert.bindString(10,day(utc));}
                    else {insert.bindNull(9);insert.bindNull(10);}
                    // The segment must exist BEFORE the FK-protected receipt.
                    if(range[2]==1){
                        db.execSQL("INSERT OR IGNORE INTO segments(bucket,first_seq,last_seq,live_count) VALUES(?,?,?,0)",
                           new Object[]{bucket,seq,seq});
                    }
                    insert.executeInsert();seq++;
                }
            }
            for(Map.Entry<Long,long[]> p:affected.entrySet()){
                long[] v=p.getValue();
                db.execSQL("UPDATE segments SET last_seq=MAX(last_seq,?),live_count=live_count+? WHERE bucket=?",
                   new Object[]{v[1],v[2],p.getKey()});
            }
            db.execSQL("UPDATE state SET next_seq=?,pending_count=pending_count+? WHERE id=1",
                new Object[]{seq,batch.size()});
            db.setTransactionSuccessful();
            return seq-1;
        }catch(RuntimeException ex){failure=ex;throw ex;}
        finally{end(db,failure);}
    }
    public void trustedTime(String boot,long elapsed,long utc,boolean authenticated) {
        if(!authenticated)throw new SecurityException("authenticated_server_time_required");
        if(boot==null || !boot.matches("[A-Za-z0-9_-]{8,100}") ||
           elapsed<0 || utc<MIN_UTC || utc>=MAX_UTC)
            throw new IllegalArgumentException("invalid_clock_anchor");
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        RuntimeException failure=null;
        try{
            read(db);
            db.execSQL("UPDATE state SET anchor_boot=?,anchor_mono=?,anchor_utc=? WHERE id=1",
                new Object[]{boot,elapsed,utc});
            try(Cursor c=db.rawQuery("SELECT seq,mono FROM receipts WHERE boot=? AND utc IS NULL ORDER BY seq",
                new String[]{boot})){
                while(c.moveToNext()){
                    long delta=c.getLong(1)-elapsed;
                    if(Math.abs(delta)>MAX_MONO_DELTA)continue;
                    long corrected=utc+delta;
                    if(corrected<MIN_UTC || corrected>=MAX_UTC)continue;
                    db.execSQL("UPDATE receipts SET utc=?,day=? WHERE seq=? AND utc IS NULL",
                        new Object[]{corrected,day(corrected),c.getLong(0)});
                }
            }
            db.setTransactionSuccessful();
        }catch(RuntimeException ex){failure=ex;throw ex;}
        finally{end(db,failure);}
    }
    public static final class Outgoing {
        public final long seq;public final String eventId,playedAt,day;
        Outgoing(long seq,String eventId,String playedAt,String day){
            this.seq=seq;this.eventId=eventId;this.playedAt=playedAt;this.day=day;
        }
    }
    public List<Outgoing> prepare(boolean online,int limit) {
        ArrayList<Outgoing> out=new ArrayList<>();
        if(!online)return out;
        if(limit<1 || limit>50)throw new IllegalArgumentException("invalid_send_limit");
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        RuntimeException failure=null;
        try{
            State s=read(db);
            try(Cursor c=db.rawQuery("SELECT seq,event_id,utc,day FROM receipts ORDER BY seq LIMIT "+limit,null)){
                while(c.moveToNext()){
                    if(c.isNull(2))break; // strict FIFO, no false 1970 timestamps
                    out.add(new Outgoing(c.getLong(0),c.getString(1),iso(c.getLong(2)),c.getString(3)));
                }
            }
            if(!out.isEmpty())
                db.execSQL("UPDATE state SET sent=MAX(sent,?) WHERE id=1",
                    new Object[]{out.get(out.size()-1).seq});
            db.setTransactionSuccessful();
        }catch(RuntimeException ex){failure=ex;throw ex;}
        finally{end(db,failure);}
        return out;
    }
    public void ack(long through,boolean serverVerified){
        if(!serverVerified)throw new SecurityException("unverified_ack");
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        RuntimeException failure=null;
        try{
            State s=read(db);
            if(through<s.ack || through>s.sent)throw new IllegalArgumentException("ack_out_of_range");
            long removed=through-s.ack;
            try(Cursor c=db.rawQuery("SELECT bucket,count(*) FROM receipts WHERE seq<=? GROUP BY bucket",
                    new String[]{Long.toString(through)})) {
                while(c.moveToNext())
                    db.execSQL("UPDATE segments SET live_count=live_count-? WHERE bucket=?",
                        new Object[]{c.getLong(1),c.getLong(0)});
            }
            db.execSQL("DELETE FROM receipts WHERE seq<=?",new Object[]{through});
            db.execSQL("DELETE FROM segments WHERE live_count=0");
            db.execSQL("UPDATE state SET ack=?,pending_count=pending_count-? WHERE id=1",
                new Object[]{through,removed});
            db.setTransactionSuccessful();
        }catch(RuntimeException ex){failure=ex;throw ex;}
        finally{end(db,failure);}
    }
    public int stageUnresolved() {
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        RuntimeException failure=null;
        try{
            State s=read(db);
            int n=0;
            try(Cursor c=db.rawQuery("SELECT seq,event_id,media,completed,seconds,boot,mono FROM receipts WHERE utc IS NULL ORDER BY seq",null)){
                while(c.moveToNext()){
                    long seq=c.getLong(0);
                    if(scalar(db,"SELECT count(*) FROM audit_proofs WHERE seq="+seq)!=0)continue;
                    String id=c.getString(1),media=c.getString(2),boot=c.getString(5);
                    boolean completed=c.getInt(3)!=0;
                    double seconds=c.getDouble(4);
                    long mono=c.getLong(6);
                    db.execSQL("INSERT INTO audit_proofs(seq,event_id,media,completed,seconds,boot,mono,proof_sha) "+
                      "VALUES(?,?,?,?,?,?,?,?)",
                      new Object[]{seq,id,media,completed?1:0,seconds,boot,mono,
                        proof(s.stream,seq,id,media,completed,seconds,boot,mono)});
                    db.execSQL("INSERT INTO audit_reviews(seq,code,evidence) VALUES(?,'PENDING_TIME','NO_TRUSTED_CLOCK')",
                        new Object[]{seq});
                    n++;
                }
            }
            db.setTransactionSuccessful();return n;
        }catch(RuntimeException ex){failure=ex;throw ex;}
        finally{end(db,failure);}
    }
    public void annotateUnverifiable(long seq,String evidence){
        if(evidence==null || !evidence.matches("[A-Za-z0-9_-]{8,120}"))
            throw new IllegalArgumentException("invalid_evidence");
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        RuntimeException failure=null;
        try{
            State s=read(db);
            try(Cursor c=db.rawQuery("SELECT event_id,media,completed,seconds,boot,mono FROM receipts WHERE seq=? AND utc IS NULL",
                new String[]{Long.toString(seq)})){
                if(!c.moveToFirst())throw new IllegalStateException("clock_not_unverified");
                String actual=proof(s.stream,seq,c.getString(0),c.getString(1),
                    c.getInt(2)!=0,c.getDouble(3),c.getString(4),c.getLong(5));
                String saved=str(db,"SELECT proof_sha FROM audit_proofs WHERE seq="+seq);
                if(!actual.equals(saved))throw new IllegalStateException("audit_proof_mismatch");
            }
            db.execSQL("INSERT INTO audit_reviews(seq,code,evidence) VALUES(?,'OLD_BOOT_UNVERIFIABLE',?)",
                new Object[]{seq,evidence});
            db.setTransactionSuccessful();
        }catch(RuntimeException ex){failure=ex;throw ex;}
        finally{end(db,failure);}
    }
    public long pending(){return read(getReadableDatabase()).count;}
    public long next(){return read(getReadableDatabase()).next;}
    public long acknowledged(){return read(getReadableDatabase()).ack;}
    public long sent(){return read(getReadableDatabase()).sent;}
    public long segments(){return scalar(getReadableDatabase(),"SELECT count(*) FROM segments");}
    public long unresolved(){return scalar(getReadableDatabase(),"SELECT count(*) FROM receipts WHERE utc IS NULL");}
    public long auditCount(){return scalar(getReadableDatabase(),"SELECT count(*) FROM audit_proofs");}
    public long auditReviews(){return scalar(getReadableDatabase(),"SELECT count(*) FROM audit_reviews");}
    public long pageBytes(){
        SQLiteDatabase db=getReadableDatabase();
        return scalar(db,"PRAGMA page_count")*scalar(db,"PRAGMA page_size");
    }
    public String integrity(){return str(getReadableDatabase(),"PRAGMA integrity_check");}
    public long countedRows(){return scalar(getReadableDatabase(),"SELECT count(*) FROM receipts");}
    public void verifyLogical(){
        SQLiteDatabase db=getReadableDatabase();
        State s=read(db);
        if(s.count!=countedRows())throw new IllegalStateException("logical_count_mismatch");
        if(s.count>0){
            if(scalar(db,"SELECT MIN(seq) FROM receipts")!=s.ack+1 ||
               scalar(db,"SELECT MAX(seq) FROM receipts")!=s.next-1)
                throw new IllegalStateException("logical_gap");
        }
        if(scalar(db,"SELECT COALESCE(sum(live_count),0) FROM segments")!=s.count)
            throw new IllegalStateException("segment_count_mismatch");
    }
}
