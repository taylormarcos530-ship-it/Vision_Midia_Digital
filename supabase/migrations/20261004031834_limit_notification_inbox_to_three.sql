create or replace function private.trim_company_notifications_to_three()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.company_notifications
  where company_id = new.company_id
    and id in (
      select id
      from public.company_notifications
      where company_id = new.company_id
      order by created_at desc, id desc
      offset 3
    );
  return new;
end;
$$;

drop trigger if exists trim_company_notifications_to_three
  on public.company_notifications;

create trigger trim_company_notifications_to_three
after insert on public.company_notifications
for each row execute function private.trim_company_notifications_to_three();
