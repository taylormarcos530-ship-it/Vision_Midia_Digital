create or replace function private.enforce_member_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare max_allowed bigint; used_count bigint;
begin
  perform private.ensure_company_writable(new.company_id);
  max_allowed := private.company_limit_value(new.company_id, 'max_users');
  if max_allowed is null then return new; end if;
  select count(*) into used_count from public.company_members cm where cm.company_id = new.company_id and cm.status <> 'disabled';
  if used_count >= max_allowed then raise exception 'plan_user_limit_reached' using errcode = 'P0001'; end if;
  return new;
end;
$$;
revoke all on function private.enforce_member_plan_limit() from public, anon, authenticated;
