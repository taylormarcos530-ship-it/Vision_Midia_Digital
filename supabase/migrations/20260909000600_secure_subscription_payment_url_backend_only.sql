revoke update (payment_url) on public.company_subscriptions from authenticated;
drop policy if exists company_subscriptions_platform_admin_payment_url_update on public.company_subscriptions;
