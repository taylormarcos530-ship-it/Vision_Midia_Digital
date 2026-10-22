-- Allow only the privileged Supabase backend to use the optional upsell catalog.
-- RLS stays enabled, and anon / authenticated retain no direct table privileges.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.vision_network_addons
  TO service_role;
