create or replace function private.company_is_serviceable(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.companies c
    left join public.company_subscriptions cs on cs.company_id = c.id
    where c.id = p_company_id
      and c.status = 'active'
      and coalesce(cs.status, 'active') not in ('suspended','cancelled')
  );
$$;
revoke all on function private.company_is_serviceable(uuid) from public, anon, authenticated;
