-- Four-batch retry model. Read-only; no writes.
WITH delivered(event_id,batch_id,completed,seconds) AS (
 VALUES ('A',1,true,15::numeric),('B',1,false,7::numeric),
 ('A',2,true,15::numeric),('B',2,false,7::numeric),
 ('C',3,true,10::numeric),('C',4,true,10::numeric)
), first_seen AS (
 SELECT DISTINCT ON(event_id) event_id,batch_id,completed,seconds
 FROM delivered ORDER BY event_id,batch_id
), stages AS (
 SELECT b.batch_id,count(f.event_id) new_events,
 coalesce(sum(f.seconds),0) added_seconds
 FROM (SELECT DISTINCT batch_id FROM delivered) b
 LEFT JOIN first_seen f ON f.batch_id=b.batch_id
 GROUP BY b.batch_id
)
SELECT batch_id,new_events,added_seconds,
 sum(new_events) OVER(ORDER BY batch_id) cumulative_events,
 sum(added_seconds) OVER(ORDER BY batch_id) cumulative_seconds
FROM stages ORDER BY batch_id;
-- Expected new_events 2,0,1,0; cumulative_events 2,2,3,3.
-- NOT a concurrency test. Concurrent sessions must be tested separately.
