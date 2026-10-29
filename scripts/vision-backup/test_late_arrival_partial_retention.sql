-- READ-ONLY simulation of a late event after partial retention.
-- This demonstrates why the current shadow totals are NOT safe for deletion.
WITH scenario AS (
 SELECT 10::bigint archived_started,8::bigint archived_completed,
  2::bigint remaining_raw_started,2::bigint remaining_raw_completed,
  1::bigint late_started,1::bigint late_completed
), check_case AS (
 SELECT archived_started+late_started expected_started,
  archived_completed+late_completed expected_completed,
  CASE WHEN remaining_raw_started+late_started>0
   THEN remaining_raw_started+late_started ELSE archived_started END current_started,
  CASE WHEN remaining_raw_started+late_started>0
   THEN remaining_raw_completed+late_completed ELSE archived_completed END current_completed
 FROM scenario
)
SELECT *,expected_started-current_started lost_started,
 expected_completed-current_completed lost_completed
FROM check_case;
-- Expected: 8 lost started, 6 lost completed.
-- BLOCK retention until an idempotent archive cursor/watermark and late-arrival
-- accounting strategy are tested against real event IDs and restorable backups.
