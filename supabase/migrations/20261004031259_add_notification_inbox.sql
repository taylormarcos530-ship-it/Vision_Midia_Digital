create table if not exists public.company_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  message text not null check (char_length(message) between 1 and 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists company_notifications_company_created_idx
  on public.company_notifications (company_id, created_at desc);

create table if not exists public.company_notification_states (
  notification_id uuid not null references public.company_notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz,
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create index if not exists company_notification_states_user_idx
  on public.company_notification_states (user_id, deleted_at, read_at);

alter table public.company_notifications enable row level security;
alter table public.company_notification_states enable row level security;

revoke all on table public.company_notifications from anon, authenticated;
revoke all on table public.company_notification_states from anon, authenticated;

grant select, insert, update, delete on table public.company_notifications to service_role;
grant select, insert, update, delete on table public.company_notification_states to service_role;
