-- Disposable PostgreSQL 17 fixture only. No Supabase URLs, secrets or real data.
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA private;
CREATE TABLE public.companies (id uuid PRIMARY KEY, timezone text);
CREATE TABLE public.devices (id uuid PRIMARY KEY, company_id uuid, name text);
CREATE TABLE public.campaigns (id uuid PRIMARY KEY, company_id uuid, name text);
CREATE TABLE public.playlists (id uuid PRIMARY KEY, company_id uuid, name text);
CREATE TABLE public.media_assets (id uuid PRIMARY KEY, company_id uuid, name text);
CREATE TABLE public.playback_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_event_id text NOT NULL,
 company_id uuid NOT NULL,device_id uuid NOT NULL,playlist_id uuid,media_id uuid,
 started_at timestamptz NOT NULL,ended_at timestamptz,duration_seconds numeric,
 completed boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),
 campaign_id uuid,device_name text,campaign_name text,playlist_name text,media_name text,
 UNIQUE(device_id,client_event_id));
CREATE TABLE public.vision_commercial_daily(
 campaign_id uuid, revision_id uuid, device_id uuid, day date,
 attempt_count bigint, completed_count bigint);
GRANT USAGE ON SCHEMA public,private TO authenticated,service_role;
GRANT SELECT ON public.companies,public.devices,public.campaigns,public.playlists,public.media_assets,public.playback_logs TO authenticated;
CREATE FUNCTION private.is_company_member(p_company_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT p_company_id::text=current_setting('vision.test_company',true) $$;
GRANT EXECUTE ON FUNCTION private.is_company_member(uuid) TO authenticated;
