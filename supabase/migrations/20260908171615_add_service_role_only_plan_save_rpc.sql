create or replace function public.save_platform_plan_internal(
  p_actor_user_id uuid,
  p_id uuid,
  p_name text,
  p_slug text,
  p_description text,
  p_monthly_price_cents integer,
  p_max_devices integer,
  p_storage_limit_mb integer,
  p_max_users integer,
  p_max_campaigns integer,
  p_is_active boolean,
  p_sort_order integer
)
returns public.plans
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan public.plans;
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if not exists (
    select 1 from public.platform_admins pa
    where pa.user_id = p_actor_user_id
      and pa.role = 'super_admin'
      and pa.status = 'active'
  ) then
    raise exception 'super_admin_required' using errcode = '42501';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 80 then raise exception 'invalid_plan_name' using errcode = '22023'; end if;
  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'invalid_plan_slug' using errcode = '22023'; end if;
  if coalesce(p_monthly_price_cents, -1) < 0 then raise exception 'invalid_plan_price' using errcode = '22023'; end if;
  if p_max_devices is not null and p_max_devices < 0 then raise exception 'invalid_plan_max_devices' using errcode = '22023'; end if;
  if p_storage_limit_mb is not null and p_storage_limit_mb < 0 then raise exception 'invalid_plan_storage_limit' using errcode = '22023'; end if;
  if p_max_users is not null and p_max_users < 1 then raise exception 'invalid_plan_max_users' using errcode = '22023'; end if;
  if p_max_campaigns is not null and p_max_campaigns < 0 then raise exception 'invalid_plan_max_campaigns' using errcode = '22023'; end if;

  if p_id is null then
    insert into public.plans(name,slug,description,monthly_price_cents,max_devices,storage_limit_mb,max_users,max_campaigns,is_active,sort_order)
    values(v_name,v_slug,nullif(btrim(coalesce(p_description,'')),''),p_monthly_price_cents,p_max_devices,p_storage_limit_mb,p_max_users,p_max_campaigns,coalesce(p_is_active,true),coalesce(p_sort_order,0))
    returning * into v_plan;
  else
    update public.plans
    set name=v_name, slug=v_slug, description=nullif(btrim(coalesce(p_description,'')),''), monthly_price_cents=p_monthly_price_cents,
        max_devices=p_max_devices, storage_limit_mb=p_storage_limit_mb, max_users=p_max_users, max_campaigns=p_max_campaigns,
        is_active=coalesce(p_is_active,true), sort_order=coalesce(p_sort_order,0)
    where id=p_id
    returning * into v_plan;
    if v_plan.id is null then raise exception 'plan_not_found' using errcode='P0002'; end if;
  end if;

  insert into public.master_audit_logs(actor_user_id,action,details)
  values(p_actor_user_id,case when p_id is null then 'plan_created' else 'plan_updated' end,jsonb_build_object('plan_id',v_plan.id));
  return v_plan;
end;
$$;

revoke all on function public.save_platform_plan_internal(uuid,uuid,text,text,text,integer,integer,integer,integer,integer,boolean,integer) from public, anon, authenticated;
grant execute on function public.save_platform_plan_internal(uuid,uuid,text,text,text,integer,integer,integer,integer,integer,boolean,integer) to service_role;
