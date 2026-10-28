-- Vision FCM pilot: non-destructive device-scoped push token registry.
-- Apply only after explicit QA review; never store Firebase service-account keys in DB.
CREATE TABLE IF NOT EXISTS public.device_push_tokens (
  device_id uuid PRIMARY KEY REFERENCES public.devices(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  fcm_token text NOT NULL CHECK (char_length(fcm_token) BETWEEN 50 AND 4096),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS device_push_tokens_token_unique
  ON public.device_push_tokens(fcm_token);
ALTER TABLE public.device_push_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.device_push_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.device_push_tokens TO service_role;
-- No anon/authenticated RLS policy. Device tokens are registered only by
-- device-gateway after validating the existing x-device-token identity.
-- ON DELETE CASCADE removes registrations when a TV is fully unpaired.
