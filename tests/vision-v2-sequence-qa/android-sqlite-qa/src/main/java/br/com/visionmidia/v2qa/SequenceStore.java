package br.com.visionmidia.v2qa;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.os.SystemClock;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * ISOLATED QA ONLY. This is NOT wired into the existing player or Android APK.
 * A valid boot identifier and AUTHENTICATED server-time sample must be provided
 * by separately audited native/auth code. A valid RTC is NEVER assumed.
 * SQLite gives atomic enqueue+sequence, send-marker and ACK; no network here.
 */
public final class SequenceStore extends SQLiteOpenHelper {
    public static final int MAX_PENDING = 2000;
    private static final long DAY_MS = 86_400_000L, MAX_ANCHOR_MS = 30L * DAY_MS;
    private static final long MIN_UTC = 1_577_836_800_000L; // 2020
    private static final long MAX_UTC = 4_102_444_800_000L; // 2100
    private static final String DB_NAME = "vision_v2_sequence_qa_only.db";

    public static final class Sample {
        public final String bootId;
        public final long elapsedMs;
        public Sample(String bootId, long elapsedMs) {
            if (bootId == null || !bootId.matches("[A-Za-z0-9_-]{8,100}") || elapsedMs < 0)
                throw new IllegalArgumentException("invalid_boot_sample");
            this.bootId = bootId; this.elapsedMs = elapsedMs;
        }
        public static Sample capture(String verifiedBootId) {
            return new Sample(verifiedBootId, SystemClock.elapsedRealtime());
        }
    }
    public static final class Playback {
        public final String eventId, mediaId;
        public final boolean completed;
        public final double seconds;
        public Playback(String eventId, String mediaId, boolean completed, double seconds) {
            if (eventId == null || !eventId.matches("[A-Za-z0-9_-]{8,128}") ||
                mediaId == null || !mediaId.matches("[A-Za-z0-9_-]{1,128}") ||
                !Double.isFinite(seconds) || seconds < 0 || seconds > 3600)
                throw new IllegalArgumentException("invalid_playback");
            this.eventId=eventId; this.mediaId=mediaId;
            this.completed=completed; this.seconds=seconds;
        }
    }
    public static final class Event {
        public final long sequence; public final String eventId, mediaId, playedAt, day;
        public final boolean completed; public final double seconds;
        Event(long seq, String eventId, String mediaId, String playedAt, String day, boolean completed, double seconds) {
            this.sequence=seq; this.eventId=eventId; this.mediaId=mediaId;
            this.playedAt=playedAt; this.day=day; this.completed=completed; this.seconds=seconds;
        }
    }
    public static final class Snapshot {
        public final long confirmed, sentThrough, nextSequence; public final int pending, unresolved;
        Snapshot(long confirmed,long sentThrough,long nextSequence,int pending,int unresolved) {
            this.confirmed=confirmed; this.sentThrough=sentThrough; this.nextSequence=nextSequence;
            this.pending=pending; this.unresolved=unresolved;
        }
    }
    private static final class State {
        String device, stream, anchorBoot; long next, confirmed, sent, anchorElapsed, anchorUtc;
    }
    private static final class Resolved {
        String iso, day;
        Resolved(String iso,String day) {this.iso=iso;this.day=day;}
    }

    public SequenceStore(Context context) { super(context, DB_NAME, null, 1); }
    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE stream_state (id INTEGER PRIMARY KEY CHECK(id=1), " +
            "device TEXT NOT NULL, stream TEXT NOT NULL, next_seq INTEGER NOT NULL CHECK(next_seq>=1), " +
            "confirmed INTEGER NOT NULL CHECK(confirmed>=0), sent_through INTEGER NOT NULL CHECK(sent_through>=0), " +
            "anchor_boot TEXT, anchor_elapsed INTEGER, anchor_utc INTEGER)");
        db.execSQL("CREATE TABLE pending (seq INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, " +
            "media TEXT NOT NULL, completed INTEGER NOT NULL, seconds REAL NOT NULL, " +
            "boot_id TEXT NOT NULL, elapsed_ms INTEGER NOT NULL, utc_ms INTEGER, played_day TEXT)");
        db.execSQL("CREATE INDEX pending_unresolved ON pending(seq) WHERE utc_ms IS NULL");
    }
    @Override public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion) {
        throw new IllegalStateException("manual_migration_required");
    }

    private static void validIdentity(String id, String stream) {
        if (id==null || !id.matches("[A-Za-z0-9_-]{3,120}") ||
            stream==null || !stream.matches("[A-Za-z0-9_-]{3,120}"))
            throw new IllegalArgumentException("invalid_identity");
    }
    private static State state(SQLiteDatabase db) {
        try (Cursor c=db.rawQuery(
            "SELECT device,stream,next_seq,confirmed,sent_through,anchor_boot,anchor_elapsed,anchor_utc FROM stream_state WHERE id=1",null)) {
            if (!c.moveToFirst()) throw new IllegalStateException("not_provisioned_repair_required");
            State s=new State();
            s.device=c.getString(0);s.stream=c.getString(1);s.next=c.getLong(2);
            s.confirmed=c.getLong(3);s.sent=c.getLong(4);s.anchorBoot=c.isNull(5)?null:c.getString(5);
            s.anchorElapsed=c.isNull(6)?-1:c.getLong(6);s.anchorUtc=c.isNull(7)?-1:c.getLong(7);
            if (s.next<1 || s.confirmed<0 || s.sent<s.confirmed || s.next<=s.sent)
                throw new IllegalStateException("state_corrupt_repair_required");
            return s;
        }
    }
    private static long scalar(SQLiteDatabase db,String sql,String[] args) {
        try (Cursor c=db.rawQuery(sql,args)) { if(!c.moveToFirst()) throw new IllegalStateException("missing_count"); return c.getLong(0); }
    }
    private static void integrity(SQLiteDatabase db,State s) {
        long n=scalar(db,"SELECT COUNT(*) FROM pending",null);
        if (n!=s.next-s.confirmed-1 || n>MAX_PENDING)
            throw new IllegalStateException("queue_gap_repair_required");
        if (n>0 && scalar(db,"SELECT MIN(seq) FROM pending",null)!=s.confirmed+1)
            throw new IllegalStateException("queue_gap_repair_required");
        if (n>0 && scalar(db,"SELECT MAX(seq) FROM pending",null)!=s.next-1)
            throw new IllegalStateException("queue_gap_repair_required");
    }

    /** Only after a distinct stream was granted by an authenticated server. Never auto-create on open. */
    public void provision(String device,String stream,boolean serverIssuedNewStream) {
        validIdentity(device,stream);
        if (!serverIssuedNewStream) throw new SecurityException("server_stream_required");
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        try {
            if (scalar(db,"SELECT COUNT(*) FROM stream_state",null)!=0)
                throw new IllegalStateException("already_provisioned_no_reset");
            if (scalar(db,"SELECT COUNT(*) FROM pending",null)!=0)
                throw new IllegalStateException("orphan_events_repair_required");
            ContentValues v=new ContentValues();v.put("id",1);v.put("device",device);v.put("stream",stream);
            v.put("next_seq",1);v.put("confirmed",0);v.put("sent_through",0);
            db.insertOrThrow("stream_state",null,v);
            db.setTransactionSuccessful();
        } finally {db.endTransaction();}
    }

    private static Resolved resolved(State s,Sample sample) {
        if(s.anchorBoot==null || !s.anchorBoot.equals(sample.bootId))return null;
        long delta=sample.elapsedMs-s.anchorElapsed;
        if (Math.abs(delta)>MAX_ANCHOR_MS) return null;
        long utc=s.anchorUtc+delta;
        if (utc<MIN_UTC || utc>=MAX_UTC) return null;
        SimpleDateFormat iso=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US);
        iso.setTimeZone(TimeZone.getTimeZone("UTC"));
        SimpleDateFormat day=new SimpleDateFormat("yyyy-MM-dd",Locale.US);
        day.setTimeZone(TimeZone.getTimeZone("America/Sao_Paulo"));
        return new Resolved(iso.format(new Date(utc)),day.format(new Date(utc)));
    }

    /** Return event sequence after committed durable insert, or reject without incrementing. */
    public long append(Playback event,Sample sample,boolean injectFailureAfterInsert) {
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        try {
            State s=state(db);integrity(db,s);
            try(Cursor c=db.rawQuery("SELECT seq,media,completed,seconds FROM pending WHERE event_id=?",new String[]{event.eventId})) {
                if(c.moveToFirst()) {
                    if(!c.getString(1).equals(event.mediaId) || (c.getInt(2)!=0)!=event.completed ||
                       c.getDouble(3)!=event.seconds)throw new IllegalStateException("event_id_conflict");
                    db.setTransactionSuccessful();return c.getLong(0);
                }
            }
            if (s.next==Long.MAX_VALUE || s.next-s.confirmed-1>=MAX_PENDING)
                throw new IllegalStateException("queue_full_repair_required");
            Resolved time=resolved(s,sample);
            ContentValues v=new ContentValues();
            v.put("seq",s.next);v.put("event_id",event.eventId);v.put("media",event.mediaId);
            v.put("completed",event.completed?1:0);v.put("seconds",event.seconds);
            v.put("boot_id",sample.bootId);v.put("elapsed_ms",sample.elapsedMs);
            if(time==null){v.putNull("utc_ms");v.putNull("played_day");}
            else {v.put("utc_ms",DateParser.parse(time.iso));v.put("played_day",time.day);}
            db.insertOrThrow("pending",null,v);
            if(injectFailureAfterInsert)throw new IllegalStateException("simulated_power_loss");
            db.execSQL("UPDATE stream_state SET next_seq=next_seq+1 WHERE id=1");
            db.setTransactionSuccessful();return s.next;
        } finally {db.endTransaction();}
    }
    // Time interpretation must be locale-independent, never default Android timezone.
    private static class DateParser {
        static long parse(String iso) {
            try {
                SimpleDateFormat f=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US);
                f.setTimeZone(TimeZone.getTimeZone("UTC"));
                f.setLenient(false);
                return f.parse(iso).getTime();
            } catch (Exception e) {throw new IllegalStateException("invalid_utc",e);}
        }
    }

    /** This boolean is a QA seam: production MUST only call after authenticated server confirmation. */
    public int recordServerTime(Sample anchor,long serverUtcMs,boolean verifiedAuthenticated) {
        if(!verifiedAuthenticated)throw new SecurityException("unverified_server_time");
        if(serverUtcMs<MIN_UTC || serverUtcMs>=MAX_UTC)throw new IllegalArgumentException("untrusted_time");
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        try {
            State s=state(db);integrity(db,s);
            ContentValues m=new ContentValues();m.put("anchor_boot",anchor.bootId);
            m.put("anchor_elapsed",anchor.elapsedMs);m.put("anchor_utc",serverUtcMs);
            db.update("stream_state",m,"id=1",null);
            s.anchorBoot=anchor.bootId;s.anchorElapsed=anchor.elapsedMs;s.anchorUtc=serverUtcMs;
            int corrected=0;
            try(Cursor c=db.rawQuery("SELECT seq,boot_id,elapsed_ms FROM pending WHERE utc_ms IS NULL ORDER BY seq",null)) {
                while(c.moveToNext()){
                    Resolved t=resolved(s,new Sample(c.getString(1),c.getLong(2)));
                    if(t==null)continue;
                    ContentValues v=new ContentValues();v.put("utc_ms",DateParser.parse(t.iso));v.put("played_day",t.day);
                    db.update("pending",v,"seq=?",new String[]{Long.toString(c.getLong(0))});corrected++;
                }
            }
            db.setTransactionSuccessful();return corrected;
        }finally{db.endTransaction();}
    }
    public Snapshot snapshot() {
        SQLiteDatabase db=getReadableDatabase();State s=state(db);integrity(db,s);
        return new Snapshot(s.confirmed,s.sent,s.next,(int)scalar(db,"SELECT COUNT(*) FROM pending",null),
            (int)scalar(db,"SELECT COUNT(*) FROM pending WHERE utc_ms IS NULL",null));
    }
    /** Mark confirmed range as 'sent' BEFORE HTTP. An uncertain response must resend it. */
    public List<Event> prepareBatch(boolean online,int limit) {
        if(!online)return new ArrayList<>();
        if(limit<1 || limit>50)throw new IllegalArgumentException("batch_limit");
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        try {
            State s=state(db);integrity(db,s);
            ArrayList<Event> out=new ArrayList<>();
            try(Cursor c=db.rawQuery("SELECT seq,event_id,media,completed,seconds,utc_ms,played_day FROM pending ORDER BY seq LIMIT "+limit,null)) {
                while(c.moveToNext()){
                    if(c.isNull(5))break; // strict FIFO: never send behind unknown clock
                    long utc=c.getLong(5);
                    SimpleDateFormat f=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US);
                    f.setTimeZone(TimeZone.getTimeZone("UTC"));
                    out.add(new Event(c.getLong(0),c.getString(1),c.getString(2),f.format(new Date(utc)),
                        c.getString(6),c.getInt(3)!=0,c.getDouble(4)));
                }
            }
            if(!out.isEmpty()){
                long last=out.get(out.size()-1).sequence;
                db.execSQL("UPDATE stream_state SET sent_through=MAX(sent_through,?) WHERE id=1",new Object[]{last});
            }
            db.setTransactionSuccessful();return out;
        }finally{db.endTransaction();}
    }
    /** Only a verified ACK for this stream may call this. Does not accept un-sent sequences. */
    public void acknowledge(long ack,boolean verifiedServerAck) {
        if(!verifiedServerAck)throw new SecurityException("unverified_ack");
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        try {
            State s=state(db);integrity(db,s);
            if(ack<s.confirmed || ack>s.sent)throw new IllegalArgumentException("ack_out_of_range");
            db.delete("pending","seq<=?",new String[]{Long.toString(ack)});
            db.execSQL("UPDATE stream_state SET confirmed=? WHERE id=1",new Object[]{ack});
            db.setTransactionSuccessful();
        }finally{db.endTransaction();}
    }
}
