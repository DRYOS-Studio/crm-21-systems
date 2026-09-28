-- Motivos de perda padronizados (catálogo do time) + registro na conversa.

create table if not exists public.loss_reasons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint loss_reasons_name_len check (char_length(btrim(name)) between 1 and 48)
);

create unique index if not exists loss_reasons_user_name_uidx
  on public.loss_reasons (user_id, lower(btrim(name)));

create index if not exists loss_reasons_user_idx on public.loss_reasons (user_id, position);

alter table public.loss_reasons enable row level security;
grant select, insert, update, delete on public.loss_reasons to authenticated;
grant all on public.loss_reasons to service_role;

drop policy if exists org_loss_reasons on public.loss_reasons;
create policy org_loss_reasons on public.loss_reasons
  for all to authenticated
  using (public.same_org(user_id))
  with check (public.same_org(user_id));

alter table public.conversations
  add column if not exists loss_reason_id uuid references public.loss_reasons(id) on delete set null,
  add column if not exists loss_reason_note text;

create index if not exists conversations_loss_reason_idx on public.conversations (loss_reason_id);

-- Catálogo inicial (conta mais antiga do time).
insert into public.loss_reasons (user_id, name, position)
select u.id, v.name, v.pos
from auth.users u
cross join (
  values
    ('Preço', 0),
    ('Sem resposta', 1),
    ('Concorrência', 2),
    ('Timing / prioridade', 3),
    ('Outro', 4)
) as v(name, pos)
where u.id = (select id from auth.users order by created_at limit 1)
  and not exists (select 1 from public.loss_reasons limit 1);
