alter table public.q7_local_access
  add column if not exists is_control_plane boolean not null default false;
