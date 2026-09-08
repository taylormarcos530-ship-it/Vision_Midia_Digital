create or replace function private.storage_upload_allowed(p_name text, p_size_bytes bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  company_text text;
  company_uuid uuid;
  max_mb bigint;
  max_bytes numeric;
  used_bytes numeric;
begin
  company_text := (storage.foldername(p_name))[1];
  if company_text is null then return false; end if;
  begin company_uuid := company_text::uuid; exception when others then return false; end;
  if not private.has_company_role_text(company_text, array['owner','admin','operator']::text[]) then return false; end if;
  perform private.ensure_company_writable(company_uuid);
  max_mb := private.company_limit_value(company_uuid, 'storage_limit_mb');
  if max_mb is null then return true; end if;
  max_bytes := max_mb::numeric * 1024 * 1024;
  select coalesce(sum(coalesce((o.metadata->>'size')::numeric,0)),0) into used_bytes
  from storage.objects o
  where o.bucket_id = 'vision-media'
    and (storage.foldername(o.name))[1] = company_text
    and o.name <> p_name
    and coalesce(o.is_delete_marker,false) = false;
  return used_bytes + greatest(coalesce(p_size_bytes,0),0) <= max_bytes;
exception when others then return false;
end;
$$;
revoke all on function private.storage_upload_allowed(text,bigint) from public, anon;
grant execute on function private.storage_upload_allowed(text,bigint) to authenticated;

drop policy if exists vision_media_insert on storage.objects;
create policy vision_media_insert on storage.objects for insert to authenticated
with check (bucket_id = 'vision-media' and (select private.storage_upload_allowed(name, coalesce((metadata->>'size')::bigint,0))));

drop policy if exists vision_media_update on storage.objects;
create policy vision_media_update on storage.objects for update to authenticated
using (bucket_id = 'vision-media' and (select private.has_company_role_text((storage.foldername(name))[1], array['owner','admin','operator']::text[])))
with check (bucket_id = 'vision-media' and (select private.storage_upload_allowed(name, coalesce((metadata->>'size')::bigint,0))));
