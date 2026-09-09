alter table public.company_subscriptions
  add column if not exists payment_url text;

alter table public.company_subscriptions
  drop constraint if exists company_subscriptions_payment_url_check;

alter table public.company_subscriptions
  add constraint company_subscriptions_payment_url_check
  check (
    payment_url is null
    or (
      char_length(payment_url) between 8 and 1200
      and payment_url ~* '^https://'
    )
  );

grant select (payment_url) on public.company_subscriptions to authenticated;
grant update (payment_url) on public.company_subscriptions to authenticated;

drop policy if exists company_subscriptions_platform_admin_payment_url_update on public.company_subscriptions;
create policy company_subscriptions_platform_admin_payment_url_update
on public.company_subscriptions
for update
to authenticated
using (
  exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = (select auth.uid())
      and pa.status = 'active'
      and pa.role in ('super_admin','admin')
  )
)
with check (
  exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = (select auth.uid())
      and pa.status = 'active'
      and pa.role in ('super_admin','admin')
  )
);
