create or replace function public.save_campaign(
  p_campaign_id uuid, p_company_id uuid, p_name text, p_playlist_id uuid, p_description text,
  p_start_date date, p_end_date date, p_start_time time without time zone, p_end_time time without time zone,
  p_weekdays smallint[], p_priority smallint, p_all_devices boolean, p_is_active boolean, p_device_ids uuid[]
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  if p_company_id is null then raise exception 'company is required'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 1 then raise exception 'campaign name is required'; end if;
  if p_weekdays is null or cardinality(p_weekdays) < 1 or not (p_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]) then raise exception 'invalid weekdays'; end if;
  if p_end_date is not null and p_start_date is not null and p_end_date < p_start_date then raise exception 'end date must not be before start date'; end if;
  if (p_start_time is null) <> (p_end_time is null) then raise exception 'start and end times must both be filled or both be empty'; end if;
  if p_start_time is not null and p_start_time = p_end_time then raise exception 'start and end times cannot be equal'; end if;
  if coalesce(p_priority, -1) < 0 or p_priority > 1000 then raise exception 'priority must be between 0 and 1000'; end if;
  if not coalesce(p_all_devices, false) and coalesce(cardinality(p_device_ids), 0) = 0 then raise exception 'select at least one device'; end if;

  if p_campaign_id is null then
    insert into public.campaigns (company_id, playlist_id, name, description, start_date, end_date, start_time, end_time, weekdays, priority, all_devices, is_active, created_by)
    values (p_company_id, p_playlist_id, trim(p_name), nullif(trim(coalesce(p_description, '')), ''), p_start_date, p_end_date, p_start_time, p_end_time, p_weekdays, p_priority, p_all_devices, p_is_active, (select auth.uid()))
    returning id into v_id;
  else
    update public.campaigns set playlist_id=p_playlist_id, name=trim(p_name), description=nullif(trim(coalesce(p_description,'')),''), start_date=p_start_date, end_date=p_end_date, start_time=p_start_time, end_time=p_end_time, weekdays=p_weekdays, priority=p_priority, all_devices=p_all_devices, is_active=p_is_active
    where id=p_campaign_id and company_id=p_company_id returning id into v_id;
    if v_id is null then raise exception 'campaign not found or not allowed'; end if;
  end if;

  delete from public.campaign_devices where campaign_id=v_id and company_id=p_company_id;
  if not p_all_devices then
    insert into public.campaign_devices(campaign_id, company_id, device_id)
    select v_id, p_company_id, selected.device_id from (select distinct unnest(p_device_ids) as device_id) selected;
  end if;
  return v_id;
end;
$$;
revoke all on function public.save_campaign(uuid,uuid,text,uuid,text,date,date,time without time zone,time without time zone,smallint[],smallint,boolean,boolean,uuid[]) from public, anon;
grant execute on function public.save_campaign(uuid,uuid,text,uuid,text,date,date,time without time zone,time without time zone,smallint[],smallint,boolean,boolean,uuid[]) to authenticated, service_role;
