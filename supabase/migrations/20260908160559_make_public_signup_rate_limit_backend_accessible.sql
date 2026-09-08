create table if not exists public.public_signup_attempts (
  id bigint generated always as identity primary key,
  source_hash text not null check (char_length(source_hash) = 64),
  email_hash text not null check (char_length(email_hash) = 64),
  attempted_at timestamptz not null default now(),
  success boolean not null default false
);

create index if not exists public_signup_attempts_source_time_idx
  on public.public_signup_attempts (source_hash, attempted_at desc);
create index if not exists public_signup_attempts_email_time_idx
  on public.public_signup_attempts (email_hash, attempted_at desc);

alter table public.public_signup_attempts enable row level security;
revoke all on table public.public_signup_attempts from public, anon, authenticated;
revoke all on sequence public.public_signup_attempts_id_seq from public, anon, authenticated;

drop policy if exists public_signup_attempts_deny_clients on public.public_signup_attempts;
create policy public_signup_attempts_deny_clients
  on public.public_signup_attempts
  for all
  to anon, authenticated
  using (false)
  with check (false);

comment on table public.public_signup_attempts is 'Backend-only rate limiting audit for public auto-confirmed signup. No client grants; service role only.';

drop table if exists private.public_signup_attempts;
