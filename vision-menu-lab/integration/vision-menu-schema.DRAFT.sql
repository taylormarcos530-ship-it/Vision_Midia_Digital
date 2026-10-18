-- Vision Menu Digital: REVIEW-ONLY SQL PROPOSAL, NOT AN APPLIED MIGRATION.
-- Never place in supabase/migrations without explicit approval and PostgreSQL/RLS testing.
-- No gateway, player, playlist, campaign, Edge or device-command hooks.
-- Requires existing private.is_company_member(), private.has_company_role(),
-- private.ensure_company_writable(), devices(id,company_id), media_assets columns.
BEGIN;

CREATE TABLE public.vision_menu_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  current_revision integer NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,company_id)
);
CREATE TABLE public.vision_menu_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id uuid NOT NULL,
  company_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  request_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (menu_id,company_id) REFERENCES public.vision_menu_drafts(id,company_id) ON DELETE CASCADE,
  UNIQUE (menu_id,revision),
  UNIQUE (menu_id,revision,company_id),
  UNIQUE (company_id,request_id)
);
CREATE TABLE public.vision_menu_intents (
  device_id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  menu_id uuid NOT NULL,
  revision integer NOT NULL,
  mode text NOT NULL CHECK (mode IN ('normal','menu_only','interleave')),
  status text NOT NULL CHECK (status IN ('normal_untouched','review_required')),
  active boolean NOT NULL DEFAULT false CHECK (active IS FALSE),
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (device_id,company_id) REFERENCES public.devices(id,company_id) ON DELETE CASCADE,
  FOREIGN KEY (menu_id,revision,company_id) REFERENCES public.vision_menu_revisions(menu_id,revision,company_id)
);
CREATE TABLE public.vision_menu_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  menu_id uuid NOT NULL,
  revision integer NOT NULL,
  device_id uuid,
  action text NOT NULL CHECK (action IN ('draft_saved','intent_staged')),
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vision_menu_drafts_company_idx ON public.vision_menu_drafts(company_id);
CREATE INDEX vision_menu_revisions_company_idx ON public.vision_menu_revisions(company_id,menu_id,revision DESC);
CREATE INDEX vision_menu_intents_company_idx ON public.vision_menu_intents(company_id);
CREATE INDEX vision_menu_audit_company_idx ON public.vision_menu_audit(company_id,created_at DESC);

ALTER TABLE public.vision_menu_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vision_menu_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vision_menu_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vision_menu_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.vision_menu_drafts,public.vision_menu_revisions,public.vision_menu_intents,public.vision_menu_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.vision_menu_drafts,public.vision_menu_revisions,public.vision_menu_intents,public.vision_menu_audit TO authenticated;
GRANT ALL ON public.vision_menu_drafts,public.vision_menu_revisions,public.vision_menu_intents,public.vision_menu_audit TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.vision_menu_audit_id_seq TO service_role;
CREATE POLICY menu_drafts_member_read ON public.vision_menu_drafts FOR SELECT TO authenticated USING ((SELECT private.is_company_member(company_id)));
CREATE POLICY menu_revisions_member_read ON public.vision_menu_revisions FOR SELECT TO authenticated USING ((SELECT private.is_company_member(company_id)));
CREATE POLICY menu_intents_member_read ON public.vision_menu_intents FOR SELECT TO authenticated USING ((SELECT private.is_company_member(company_id)));
CREATE POLICY menu_audit_member_read ON public.vision_menu_audit FOR SELECT TO authenticated USING ((SELECT private.is_company_member(company_id)));

-- Only these RPCs can write for authenticated users. All writes remain quarantined
-- inside menu tables; the Player reads none of them.
CREATE FUNCTION public.vision_menu_save_draft(
  p_company_id uuid, p_menu_id uuid, p_expected_revision integer,
  p_request_id uuid, p_snapshot jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_menu public.vision_menu_drafts%ROWTYPE;
  v_old public.vision_menu_revisions%ROWTYPE;
  v_menu_id uuid;
  v_item jsonb;
  v_logo uuid;
  v_video uuid;
  v_new_revision integer;
BEGIN
  IF v_actor IS NULL OR NOT private.has_company_role(p_company_id,ARRAY['owner','admin','operator']::text[])
     THEN RAISE EXCEPTION 'menu_write_denied' USING ERRCODE='42501'; END IF;
  PERFORM private.ensure_company_writable(p_company_id);
  IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object'
     THEN RAISE EXCEPTION 'menu_invalid_request'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_snapshot)) <> 6
     OR NOT (p_snapshot ?& ARRAY['templateKey','intervalSeconds','storeName','products','logoAssetId','videoAssetId'])
     OR jsonb_typeof(p_snapshot->'templateKey') IS DISTINCT FROM 'string'
     OR p_snapshot->>'templateKey' <> 'butcher-01'
     OR p_snapshot->>'intervalSeconds' NOT IN ('5','10','15')
     OR jsonb_typeof(p_snapshot->'intervalSeconds') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_snapshot->'storeName') IS DISTINCT FROM 'string'
     OR NOT (length(trim(p_snapshot->>'storeName')) BETWEEN 1 AND 120)
     OR jsonb_typeof(p_snapshot->'products') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_snapshot->'products') > 300
     THEN RAISE EXCEPTION 'menu_invalid_snapshot'; END IF;
  IF jsonb_typeof(p_snapshot->'logoAssetId') NOT IN ('string','null')
     OR jsonb_typeof(p_snapshot->'videoAssetId') NOT IN ('string','null')
     THEN RAISE EXCEPTION 'menu_invalid_assets'; END IF;
  v_logo := (p_snapshot->>'logoAssetId')::uuid;
  v_video := (p_snapshot->>'videoAssetId')::uuid;
  IF v_logo IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.media_assets a WHERE a.id=v_logo AND a.company_id=p_company_id
      AND a.media_type='image' AND a.processing_status='ready' AND a.storage_path IS NOT NULL
  ) THEN RAISE EXCEPTION 'menu_logo_not_allowed'; END IF;
  IF v_video IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.media_assets a WHERE a.id=v_video AND a.company_id=p_company_id
      AND a.media_type='video' AND a.processing_status='ready' AND a.storage_path IS NOT NULL
  ) THEN RAISE EXCEPTION 'menu_video_not_allowed'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_snapshot->'products') LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(v_item)) <> 4
       OR NOT (v_item ?& ARRAY['id','name','priceCents','enabled'])
       OR jsonb_typeof(v_item->'id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item->'name') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item->'priceCents') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_item->'enabled') IS DISTINCT FROM 'boolean'
       OR NOT (length(trim(v_item->>'name')) BETWEEN 1 AND 48)
       OR (v_item->>'priceCents') !~ '^[0-9]{1,8}$'
    THEN RAISE EXCEPTION 'menu_invalid_product'; END IF;
    PERFORM (v_item->>'id')::uuid;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(p_snapshot->'products') p)
     <> (SELECT count(DISTINCT p.value->>'id') FROM jsonb_array_elements(p_snapshot->'products') p)
     THEN RAISE EXCEPTION 'menu_duplicate_product'; END IF;

  -- Idempotent replay returns original result only when the SAME request and actor
  -- reuse the exact same payload. All writes run transactionally.
  SELECT * INTO v_old FROM public.vision_menu_revisions
     WHERE company_id=p_company_id AND request_id=p_request_id;
  IF FOUND THEN
    IF v_old.created_by <> v_actor OR v_old.snapshot <> p_snapshot
       OR (p_menu_id IS NOT NULL AND p_menu_id <> v_old.menu_id)
       THEN RAISE EXCEPTION 'menu_idempotency_conflict'; END IF;
    RETURN jsonb_build_object('menu_id',v_old.menu_id,'revision',v_old.revision,'already_committed',true);
  END IF;

  IF p_menu_id IS NULL THEN
    IF p_expected_revision <> 0 THEN RAISE EXCEPTION 'menu_revision_conflict'; END IF;
    INSERT INTO public.vision_menu_drafts(company_id,updated_by)
      VALUES(p_company_id,v_actor) RETURNING * INTO v_menu;
  ELSE
    SELECT * INTO v_menu FROM public.vision_menu_drafts
       WHERE id=p_menu_id AND company_id=p_company_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'menu_not_found'; END IF;
  END IF;
  IF v_menu.current_revision <> p_expected_revision THEN RAISE EXCEPTION 'menu_revision_conflict'; END IF;
  v_new_revision := v_menu.current_revision+1;
  v_menu_id := v_menu.id;
  INSERT INTO public.vision_menu_revisions(menu_id,company_id,revision,request_id,snapshot,created_by)
    VALUES(v_menu_id,p_company_id,v_new_revision,p_request_id,p_snapshot,v_actor);
  UPDATE public.vision_menu_drafts SET snapshot=p_snapshot,current_revision=v_new_revision,
     updated_at=now(),updated_by=v_actor WHERE id=v_menu_id AND company_id=p_company_id;
  INSERT INTO public.vision_menu_audit(company_id,menu_id,revision,action,actor_id)
     VALUES(p_company_id,v_menu_id,v_new_revision,'draft_saved',v_actor);
  RETURN jsonb_build_object('menu_id',v_menu_id,'revision',v_new_revision,'already_committed',false);
END $$;

CREATE FUNCTION public.vision_menu_stage_intent(
  p_company_id uuid,p_menu_id uuid,p_revision integer,p_device_id uuid,p_mode text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_status text;
  v_snapshot jsonb;
BEGIN
  IF v_actor IS NULL OR NOT private.has_company_role(p_company_id,ARRAY['owner','admin','operator']::text[])
     THEN RAISE EXCEPTION 'menu_write_denied' USING ERRCODE='42501'; END IF;
  PERFORM private.ensure_company_writable(p_company_id);
  IF p_mode NOT IN ('normal','menu_only','interleave') OR p_mode IS NULL
     THEN RAISE EXCEPTION 'menu_invalid_mode'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.devices d WHERE d.id=p_device_id AND d.company_id=p_company_id
       AND d.retired_at IS NULL AND coalesce(d.access_status,'active')='active'
       AND d.status <> 'disabled') THEN RAISE EXCEPTION 'menu_device_not_allowed'; END IF;
  SELECT snapshot INTO v_snapshot FROM public.vision_menu_revisions
      WHERE menu_id=p_menu_id AND company_id=p_company_id AND revision=p_revision;
  IF NOT FOUND THEN RAISE EXCEPTION 'menu_revision_not_found'; END IF;
  IF p_mode <> 'normal' AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_snapshot->'products') x WHERE x.value->>'enabled'='true'
     ) THEN RAISE EXCEPTION 'menu_empty'; END IF;

  -- Critical: no live status exists in the proposal. Does NOT update devices,
  -- device_playlist_assignments, campaigns, manifests or commercial targets.
  v_status := CASE WHEN p_mode='normal' THEN 'normal_untouched' ELSE 'review_required' END;
  INSERT INTO public.vision_menu_intents(device_id,company_id,menu_id,revision,mode,status,active,actor_id)
      VALUES(p_device_id,p_company_id,p_menu_id,p_revision,p_mode,v_status,false,v_actor)
      ON CONFLICT(device_id) DO UPDATE SET
        menu_id=EXCLUDED.menu_id,revision=EXCLUDED.revision,mode=EXCLUDED.mode,
        status=EXCLUDED.status,active=false,actor_id=v_actor,updated_at=now()
        WHERE public.vision_menu_intents.company_id=p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'menu_device_conflict'; END IF;
  INSERT INTO public.vision_menu_audit(company_id,menu_id,revision,device_id,action,actor_id)
      VALUES(p_company_id,p_menu_id,p_revision,p_device_id,'intent_staged',v_actor);
  RETURN jsonb_build_object('device_id',p_device_id,'status',v_status,'active',false);
END $$;
REVOKE ALL ON FUNCTION public.vision_menu_save_draft(uuid,uuid,integer,uuid,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.vision_menu_stage_intent(uuid,uuid,integer,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vision_menu_save_draft(uuid,uuid,integer,uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vision_menu_stage_intent(uuid,uuid,integer,uuid,text) TO authenticated;
COMMIT;
