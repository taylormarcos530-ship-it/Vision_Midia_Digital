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
ALTER TABLE public.companies ADD COLUMN status text NOT NULL DEFAULT 'active';
INSERT INTO public.companies(id,timezone) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','America/Sao_Paulo'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','America/Sao_Paulo');


INSERT INTO public.devices(id,company_id,name) VALUES
 ('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','QA TV Alpha'),
 ('10000000-0000-4000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','QA TV Beta');
INSERT INTO public.company_subscriptions(company_id,status,payment_status) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','active','waived'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','active','waived');
INSERT INTO public.device_pairing_requests(device_id,status,issued_token) VALUES
 ('10000000-0000-4000-8000-000000000001','ready',NULL),
 ('10000000-0000-4000-8000-000000000002','ready',NULL);
