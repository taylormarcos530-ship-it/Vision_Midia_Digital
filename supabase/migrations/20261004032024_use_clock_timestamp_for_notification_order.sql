alter table public.company_notifications
  alter column created_at set default clock_timestamp();
