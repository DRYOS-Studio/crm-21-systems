-- Nomes do time no filtro de usuário (inbox / kanban / prospecção).

drop policy if exists org_view_profiles on public.profiles;
create policy org_view_profiles on public.profiles
  for select to authenticated
  using (public.same_org(user_id));
