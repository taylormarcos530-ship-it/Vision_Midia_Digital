drop policy if exists platform_admins_deny_direct_client on public.platform_admins;
create policy platform_admins_deny_direct_client on public.platform_admins for select to authenticated using (false);

drop policy if exists master_audit_logs_deny_direct_client on public.master_audit_logs;
create policy master_audit_logs_deny_direct_client on public.master_audit_logs for select to authenticated using (false);
