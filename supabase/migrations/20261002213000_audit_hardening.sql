-- Vision Midia Digital audit hardening.
-- Prepared in preview branch; apply only during the official Supabase release.

create index if not exists idx_devices_access_updated_by
  on public.devices(access_updated_by)
  where access_updated_by is not null;

create index if not exists idx_payment_receipts_reviewed_by
  on public.payment_receipts(reviewed_by)
  where reviewed_by is not null;

create index if not exists idx_payment_receipts_submitted_by
  on public.payment_receipts(submitted_by)
  where submitted_by is not null;

create or replace function public.sweep_stale_devices(p_stale_seconds integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer := 0;
begin
  update public.devices
     set status = 'offline'
   where retired_at is null
     and status = 'online'
     and (last_seen_at is null or last_seen_at < now() - make_interval(secs => greatest(30, p_stale_seconds)));

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.sweep_stale_devices(integer) from public;
grant execute on function public.sweep_stale_devices(integer) to service_role;

create or replace function public.cancel_commands_for_retired_device()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.retired_at is null and new.retired_at is not null then
    update public.device_commands
       set status = 'cancelled',
           completed_at = coalesce(completed_at, now()),
           error_message = coalesce(error_message, 'TV aposentada antes da execução do comando.')
     where device_id = new.id
       and company_id = new.company_id
       and status in ('pending','sent');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cancel_commands_on_device_retire on public.devices;
create trigger trg_cancel_commands_on_device_retire
after update of retired_at on public.devices
for each row
when (old.retired_at is null and new.retired_at is not null)
execute function public.cancel_commands_for_retired_device();

update public.device_commands c
   set status = 'cancelled',
       completed_at = coalesce(c.completed_at, now()),
       error_message = coalesce(c.error_message, 'TV aposentada antes da execução do comando.')
  from public.devices d
 where d.id = c.device_id
   and d.company_id = c.company_id
   and d.retired_at is not null
   and c.status in ('pending','sent');

select public.sweep_stale_devices(90);
