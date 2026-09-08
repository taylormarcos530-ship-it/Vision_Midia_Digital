create table if not exists private.public_signup_attempts (
  id bigint generated always as identity primary key,
  source_hash text not null check (char_length(source_hash) = 64),
  email_hash text not null check (char_length(email_hash) = 64),
  attempted_at timestamptz not null default now(),
  success boolean not null default false
);

create index if not exists public_signup_attempts_source_time_idx
  on private.public_signup_attempts (source_hash, attempted_at desc);
create index if not exists public_signup_attempts_email_time_idx
  on private.public_signup_attempts (email_hash, attempted_at desc);

alter table private.public_signup_attempts enable row level security;
revoke all on table private.public_signup_attempts from public, anon, authenticated;
revoke all on sequence private.public_signup_attempts_id_seq from public, anon, authenticated;

comment on table private.public_signup_attempts is 'Backend-only rate limiting audit for public auto-confirmed signup.';
