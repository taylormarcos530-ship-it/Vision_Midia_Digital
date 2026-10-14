-- DRAFT ONLY: run on isolated homologation Supabase AFTER creating two TEST Auth users.
-- This does NOT create Auth users or handle passwords.
-- Replace both __TEST_EMAIL_*__ placeholders with independently verified test emails.
-- The first SQL statement rejects any project without the staging-only marker.
begin;
set local statement_timeout='15s';
do $bind_staging$
declare
 email_a text:=lower(trim('__TEST_EMAIL_A__'));
 email_b text:=lower(trim('__TEST_EMAIL_B__'));
 uid_a uuid;
 uid_b uuid;
begin
 if to_regclass('private.vision_staging_guard') is null then
  raise exception 'staging_only_guard_rejected';
 end if;
 if not exists(select 1 from private.vision_staging_guard where project_ref='jmiuitrrhtaeyrpuyohk') then
  raise exception 'staging_only_guard_rejected';
 end if;
 if email_a like '%__test_email%' or email_b like '%__test_email%'
   or email_a=email_b or position('@' in email_a)<2 or position('@' in email_b)<2 then
  raise exception 'provide_two_distinct_test_emails';
 end if;
 select u.id into uid_a from auth.users u
  where lower(u.email)=email_a and u.email_confirmed_at is not null
  and u.is_anonymous is not true
  and u.encrypted_password is not null and length(u.encrypted_password)>0;
 select u.id into uid_b from auth.users u
  where lower(u.email)=email_b and u.email_confirmed_at is not null
  and u.is_anonymous is not true
  and u.encrypted_password is not null and length(u.encrypted_password)>0;
 if uid_a is null or uid_b is null or uid_a=uid_b then
  raise exception 'test_users_not_confirmed_or_not_found';
 end if;
 if exists(select 1 from public.platform_admins where user_id in (uid_a,uid_b))
  or exists(select 1 from public.company_members where user_id in (uid_a,uid_b))
  or exists(select 1 from public.companies where owner_user_id in (uid_a,uid_b)) then
  raise exception 'separate_advertiser_account';
 end if;
 -- Do not reassign a different advertiser identity to an existing Auth user.
 if exists(select 1 from public.vision_advertisers
  where user_id in (uid_a,uid_b) and archived_at is not null) then
  raise exception 'archived_account_requires_master_review';
 end if;
 insert into public.vision_advertisers(user_id,name,email,status)
  values(uid_a,'Anunciante A - Homologacao',email_a,'active')
  on conflict(user_id) do nothing;
 insert into public.vision_advertisers(user_id,name,email,status)
  values(uid_b,'Anunciante B - Homologacao',email_b,'active')
  on conflict(user_id) do nothing;
 if (select count(*) from public.vision_advertisers
   where user_id in (uid_a,uid_b) and status='active' and archived_at is null)<>2 then
  raise exception 'test_binding_incomplete';
 end if;
end $bind_staging$;
commit;
-- Note: advertiser IDs are generated. Add only fictitious campaigns in a separate review.
