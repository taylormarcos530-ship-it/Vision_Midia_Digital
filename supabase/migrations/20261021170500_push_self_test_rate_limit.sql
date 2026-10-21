-- Rate-limit user-initiated push tests without changing existing subscriptions.
alter table public.web_push_subscriptions add column if not exists last_test_at timestamptz;
