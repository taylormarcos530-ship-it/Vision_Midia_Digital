-- Allow authorized company operators to create/update Player branding.
-- SELECT policy already exists; storage policies remain unchanged.

create policy company_player_branding_member_insert
on public.company_player_branding
for insert
to authenticated
with check (
  private.has_company_role_text(company_id::text, array['owner','admin','operator']::text[])
);

create policy company_player_branding_member_update
on public.company_player_branding
for update
to authenticated
using (
  private.has_company_role_text(company_id::text, array['owner','admin','operator']::text[])
)
with check (
  private.has_company_role_text(company_id::text, array['owner','admin','operator']::text[])
);
