-- VISION COMMERCIAL — REVERSIBLE END-TO-END SQL ACCEPTANCE (STAGING ONLY)
-- Approved project: jmiuitrrhtaeyrpuyohk. Never run on production.
-- Creates fake DB metadata only: NOT an actual Storage upload, TV handshake or playback.
-- All rows MUST disappear at the final ROLLBACK; do not replace it with COMMIT.
BEGIN;
DO $commercial_staging_acceptance$
DECLARE
  a uuid; b uuid; actor uuid; company uuid:=gen_random_uuid();
  dev uuid:=gen_random_uuid(); source_id uuid:=gen_random_uuid(); revision uuid;
  campaign uuid; copy_name text:='commercial-ads/'||gen_random_uuid()::text||'.webp';
  origin text:='commercial-lab-source/'||gen_random_uuid()::text||'.webp';
  clock timestamptz:=now(); today date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date;
  result jsonb; view_a jsonb; view_b jsonb; missing_copy_rejected boolean:=false; errmsg text;
BEGIN
 IF (SELECT project_ref FROM private.vision_staging_guard LIMIT 1)
       IS DISTINCT FROM 'jmiuitrrhtaeyrpuyohk'
    OR to_regclass('vision_menu_lab.vision_menu_drafts') IS NULL
 THEN RAISE EXCEPTION 'staging_only_guard_rejected'; END IF;
 IF EXISTS(SELECT 1 FROM public.devices) OR EXISTS(SELECT 1 FROM public.companies)
    OR EXISTS(SELECT 1 FROM public.media_assets) OR EXISTS(SELECT 1 FROM public.playback_logs)
    OR EXISTS(SELECT 1 FROM public.vision_commercial_revisions)
    OR EXISTS(SELECT 1 FROM public.vision_commercial_targets)
    OR EXISTS(SELECT 1 FROM public.vision_commercial_daily)
    OR EXISTS(SELECT 1 FROM storage.objects)
 THEN RAISE EXCEPTION 'unexpected_existing_operational_fixtures'; END IF;

 SELECT id INTO a FROM public.vision_advertisers
  WHERE status='active' AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1;
 SELECT id INTO b FROM public.vision_advertisers
  WHERE status='active' AND archived_at IS NULL AND id<>a ORDER BY created_at LIMIT 1;
 SELECT user_id INTO actor FROM public.platform_admins
  WHERE role IN ('admin','super_admin') AND status='active' LIMIT 1;
 IF a IS NULL OR b IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'two_test_advertisers_and_master_required';END IF;

 INSERT INTO public.companies(id,name,owner_user_id)
 VALUES(company,'ACCEPTANCE LAB - NOT AN ESTABLISHMENT',NULL);
 INSERT INTO public.devices(id,company_id,name,last_seen_at)
 VALUES(dev,company,'TV SIMULATED OFFLINE',NULL);
 INSERT INTO public.media_assets(id,company_id,name,media_type,storage_path,source_url,
 duration_seconds,size_bytes,checksum_sha256,width,height,processing_status,updated_at)
 VALUES(source_id,company,'FAKE MEDIA METADATA','image',origin,NULL,15,1024,'fake-not-a-sha',1920,1080,'ready',clock);
 -- Metadata only. Nothing is uploaded or accessed through the Storage API.
 INSERT INTO storage.objects(bucket_id,name,metadata) VALUES
 ('vision-media',origin,'{"mimetype":"image/webp","size":1024}'::jsonb),
 ('vision-media',copy_name,'{"mimetype":"image/webp","size":1024}'::jsonb);

 BEGIN
  PERFORM public.vision_commercial_save_campaign(actor,jsonb_build_object(
    'advertiser_id',a,'name','LAB - NO REAL DELIVERY','media_id',source_id,
    'start_date',today,'end_date',today+7,'status','active','device_ids',jsonb_build_array(dev)));
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS errmsg=MESSAGE_TEXT;
  IF errmsg='commercial_snapshot_required' THEN missing_copy_rejected:=true;
  ELSE RAISE EXCEPTION 'snapshot_guard_unexpected_error: %',errmsg;END IF;
 END;
 IF NOT missing_copy_rejected THEN RAISE EXCEPTION 'missing_copy_not_blocked';END IF;
 result:=public.vision_commercial_save_campaign(actor,jsonb_build_object(
  'advertiser_id',a,'name','LAB - NO REAL DELIVERY','media_id',source_id,
  'start_date',today,'end_date',today+7,'status','active',
  'device_ids',jsonb_build_array(dev),'commercial_copy_path',copy_name));
 IF result->>'snapshot_used'<>'true' THEN RAISE EXCEPTION 'copy_metadata_not_used';END IF;
 campaign:=(result->>'id')::uuid;
 SELECT current_revision_id INTO revision FROM public.vision_commercial_campaigns WHERE id=campaign;
 IF revision IS NULL OR (SELECT storage_path FROM public.vision_commercial_revisions WHERE id=revision)<>copy_name
 OR jsonb_array_length(public.vision_commercial_manifest(dev))<>1
 OR (SELECT storage_path FROM public.media_assets WHERE id=source_id)<>origin
 THEN RAISE EXCEPTION 'save_manifest_or_immutability_failed'; END IF;

 INSERT INTO public.playback_logs(device_id,client_event_id,media_id,started_at,ended_at,completed)
 VALUES
 (dev,gen_random_uuid()::text,revision,clock-interval '120 seconds',clock-interval '105 seconds',true),
 (dev,gen_random_uuid()::text,revision,clock-interval '90 seconds',clock-interval '75 seconds',true),
 (dev,gen_random_uuid()::text,revision,clock-interval '55 seconds',NULL,false),
 (dev,gen_random_uuid()::text,revision,clock-interval '45 seconds',clock-interval '50 seconds',true);
 PERFORM public.vision_commercial_refresh_daily(dev);
 PERFORM public.vision_commercial_refresh_daily(dev);
 IF (SELECT count(*) FROM public.vision_commercial_daily WHERE revision_id=revision)<>1
 OR (SELECT attempt_count FROM public.vision_commercial_daily WHERE revision_id=revision)<>4
 OR (SELECT completed_count FROM public.vision_commercial_daily WHERE revision_id=revision)<>2
 THEN RAISE EXCEPTION 'daily_completed_counts_not_idempotent';END IF;

 view_a:=public.vision_commercial_master_report(actor,a);
 view_b:=private.vision_portal_data(b);
 IF (SELECT coalesce(sum((item->>'completed_count')::integer),0)
     FROM jsonb_array_elements(view_a->'daily') item)<>2
 OR view_a::text LIKE '%source_storage_path%' OR view_a::text LIKE '%source_media_id%'
 OR view_b::text LIKE '%LAB - NO REAL DELIVERY%'
 OR jsonb_array_length(view_b->'daily')<>0
 THEN RAISE EXCEPTION 'report_privacy_or_cross_advertiser_failure';END IF;

 UPDATE public.vision_commercial_campaigns SET status='paused' WHERE id=campaign;
 IF jsonb_array_length(public.vision_commercial_manifest(dev))<>0
 THEN RAISE EXCEPTION 'paused_ad_still_in_manifest';END IF;
 UPDATE public.vision_commercial_campaigns SET status='active' WHERE id=campaign;
 UPDATE public.vision_advertisers SET status='disabled',archived_at=now() WHERE id=a;
 IF jsonb_array_length(public.vision_commercial_manifest(dev))<>0
 THEN RAISE EXCEPTION 'archived_ad_still_in_manifest';END IF;

 PERFORM set_config('vision.qa_commercial_acceptance','PASS: snapshot required; save+manifest; 2/4 valid; idempotent; private; pause/archive; rollback pending',true);
END
$commercial_staging_acceptance$;
SELECT current_setting('vision.qa_commercial_acceptance',true) AS result,
 (SELECT count(*) FROM public.devices) AS temporary_devices,
 (SELECT count(*) FROM public.vision_commercial_daily) AS temporary_daily_rows;
ROLLBACK;
