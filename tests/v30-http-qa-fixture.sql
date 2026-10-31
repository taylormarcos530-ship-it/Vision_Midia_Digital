-- Disposable PostgreSQL 17 ONLY. Every ID and token is synthetic.
CREATE TABLE public.device_credentials(
 device_id uuid NOT NULL,token_hash text NOT NULL UNIQUE,
 revoked_at timestamptz,last_used_at timestamptz
);
CREATE TABLE public.company_subscriptions (
 company_id uuid PRIMARY KEY,
 status text NOT NULL,trial_ends_at timestamptz,current_period_end timestamptz,
 payment_status text NOT NULL
);
CREATE TABLE public.device_pairing_requests(
 device_id uuid,status text NOT NULL,issued_token text
);
INSERT INTO public.companies VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','America/Sao_Paulo'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','America/Sao_Paulo');

