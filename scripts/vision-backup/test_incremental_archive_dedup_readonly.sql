-- Read-only deterministic model test; no real playback records are changed.
-- Batch 1: A,B. Batch 2: resend A,B. Batch 3: late C.
WITH delivered(event_id,batch_id,completed,seconds) AS (
 VALUES ('A',1,true,15::numeric),('B',1,false,7::numeric),
        ('A',2,true,15::numeric),('B',2,false,7::numeric),
        ('C',3,true,10::numeric)
), first_delivery AS (
 SELECT DISTINCT ON(event_id) event_id,batch_id,completed,seconds
 FROM delivered ORDER BY event_id,batch_id
), result AS (
 SELECT count(*)::bigint started,
 count(*) FILTER(WHERE completed)::bigint completed,
 sum(seconds) total_seconds FROM first_delivery
)
SELECT (SELECT count(*) FROM delivered) deliveries,
 (SELECT count(*) FROM first_delivery) unique_events,
 started,completed,total_seconds,
 (started=3 AND completed=2 AND total_seconds=32) AS pass
FROM result;
-- This does not establish transactional safety. Separate tests must verify
-- duplicate retries, two concurrent archive workers, and a late event
-- arriving after a previously archived day's original rows were deleted.
-- Do not deploy cleanup before those tests, report v2, and verified backup.
