-- Execute ONLY on disposable GitHub Actions PostgreSQL17.
DO $$ BEGIN
 IF current_database() <> 'vision_v2_quarantine_disposable' THEN
  RAISE EXCEPTION 'DENY production database';
 END IF;
END $$;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE SCHEMA private;
CREATE SCHEMA qa_rpc;
CREATE TABLE private.memberships (
 company_id uuid NOT NULL,user_id text NOT NULL,
 PRIMARY KEY(company_id,user_id));
CREATE OR REPLACE FUNCTION private.is_company_member(c uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
 SELECT EXISTS (
  SELECT 1 FROM private.memberships m
  WHERE m.company_id=c
    AND m.user_id=current_setting('request.jwt.claim.sub',true)
    AND m.company_id::text=current_setting('request.jwt.claim.company_id',true)
 );
$$;
REVOKE ALL ON FUNCTION private.is_company_member(uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_company_member(uuid) TO authenticated;
CREATE TABLE public.companies (
 id uuid PRIMARY KEY,timezone text NOT NULL DEFAULT 'America/Sao_Paulo');
CREATE TABLE public.devices(
 id uuid PRIMARY KEY,company_id uuid NOT NULL,name text NOT NULL);
CREATE TABLE public.campaigns(
 id uuid PRIMARY KEY,company_id uuid NOT NULL,name text NOT NULL);
CREATE TABLE public.playlists(
 id uuid PRIMARY KEY,company_id uuid NOT NULL,name text NOT NULL);
CREATE TABLE public.media_assets(
 id uuid PRIMARY KEY,company_id uuid NOT NULL,name text NOT NULL);
CREATE TABLE public.playback_logs(
 id uuid PRIMARY KEY,client_event_id text NOT NULL,
 company_id uuid NOT NULL,device_id uuid NOT NULL,
 campaign_id uuid NULL,playlist_id uuid NULL,media_id uuid NULL,
 device_name text NULL,campaign_name text NULL,
 playlist_name text NULL,media_name text NULL,
 started_at timestamptz NOT NULL,ended_at timestamptz NULL,
 duration_seconds numeric NOT NULL DEFAULT 0,
 completed boolean NOT NULL DEFAULT false,
 UNIQUE(device_id,client_event_id));
CREATE INDEX qa_live_company_time ON public.playback_logs(company_id,started_at DESC);
CREATE INDEX qa_live_company_device_time ON public.playback_logs(company_id,device_id,started_at DESC);
CREATE INDEX qa_live_company_campaign_time ON public.playback_logs(company_id,campaign_id,started_at DESC);
CREATE TABLE qa_rpc.read_events (LIKE public.playback_logs INCLUDING ALL);
CREATE TABLE qa_rpc.daily(
 company_id uuid NOT NULL,local_day date NOT NULL,
 device_id uuid NOT NULL,campaign_id uuid NULL,media_id uuid NULL,playlist_id uuid NULL,
 display_device text NOT NULL,display_campaign text NOT NULL,
 display_media text NOT NULL,display_playlist text NOT NULL,
 started bigint NOT NULL,completed bigint NOT NULL,seconds numeric NOT NULL,
 first_play timestamptz NOT NULL,last_play timestamptz NOT NULL);
CREATE INDEX qa_daily_company_day ON qa_rpc.daily(company_id,local_day);
CREATE TABLE qa_rpc.cursor(
 singleton integer PRIMARY KEY CHECK(singleton=1),
 projected_count bigint NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
INSERT INTO qa_rpc.cursor(singleton) VALUES(1);
CREATE TABLE qa_rpc.pending_without_time(
 company_id uuid NOT NULL,device_id uuid NOT NULL,sequence bigint NOT NULL,
 client_event_id text NOT NULL,started_at timestamptz NULL CHECK(started_at IS NULL),
 billable boolean NOT NULL DEFAULT false CHECK(billable=false),
 PRIMARY KEY(device_id,sequence));
GRANT USAGE ON SCHEMA qa_rpc TO authenticated;
GRANT SELECT ON public.companies,public.devices,public.campaigns,public.playlists,
 public.media_assets,public.playback_logs,qa_rpc.read_events,qa_rpc.daily,
 qa_rpc.pending_without_time TO authenticated;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playback_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_rpc.read_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_rpc.daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_rpc.pending_without_time ENABLE ROW LEVEL SECURITY;
CREATE POLICY c ON public.companies TO authenticated
 USING(id::text=current_setting('request.jwt.claim.company_id',true));
CREATE POLICY d ON public.devices TO authenticated
 USING(company_id::text=current_setting('request.jwt.claim.company_id',true));
CREATE POLICY ca ON public.campaigns TO authenticated
 USING(company_id::text=current_setting('request.jwt.claim.company_id',true));
CREATE POLICY pl ON public.playlists TO authenticated
 USING(company_id::text=current_setting('request.jwt.claim.company_id',true));
CREATE POLICY me ON public.media_assets TO authenticated
 USING(company_id::text=current_setting('request.jwt.claim.company_id',true));
CREATE POLICY logs ON public.playback_logs TO authenticated
 USING(company_id::text=current_setting('request.jwt.claim.company_id',true));
CREATE POLICY read_model ON qa_rpc.read_events TO authenticated
 USING(company_id::text=current_setting('request.jwt.claim.company_id',true));
CREATE POLICY daily_model ON qa_rpc.daily TO authenticated
 USING(company_id::text=current_setting('request.jwt.claim.company_id',true));
CREATE POLICY pending ON qa_rpc.pending_without_time TO authenticated
 USING(company_id::text=current_setting('request.jwt.claim.company_id',true));
