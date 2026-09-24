-- Q1 (design §3.2): rodar ANTES de aplicar 20260925020000_phone_canon.sql. Só leitura, só agregado.
-- É ESTIMATIVA: a autoridade é o passo (2) da própria migration, que aborta antes de escrever.
-- Se a 2ª query devolver linhas, a migration vai abortar de propósito: decidir o que fazer com as duplicatas antes.

-- 1) Distribuição de formato
select case
         when contact_phone is null then 'null'
         when contact_phone !~ '^[0-9]+$' then 'nao-digitos'
         when length(contact_phone) = 13 and contact_phone like '55%' then '55+13'
         when length(contact_phone) = 12 and contact_phone like '55%' and substr(contact_phone, 5, 1) between '6' and '9' then '55+12 celular sem 9'
         when length(contact_phone) = 12 and contact_phone like '55%' then '55+12 fixo'
         else 'outro len=' || length(contact_phone) || ' ini=' || left(contact_phone, 2)
       end as formato,
       count(*) as conversas,
       count(*) filter (where exists (select 1 from public.messages m where m.conversation_id = c.id)) as com_mensagem
from public.conversations c
group by 1 order by 2 desc;

-- 2) Colisões que a canonicalização criaria (mesma chave, mesmo usuário)
with k as (
  select user_id,
         case when regexp_replace(contact_phone, '\D', '', 'g') ~ '^55[0-9]{2}[6-9][0-9]{7}$'
              then substr(regexp_replace(contact_phone, '\D', '', 'g'), 1, 4) || '9' || substr(regexp_replace(contact_phone, '\D', '', 'g'), 5)
              else regexp_replace(contact_phone, '\D', '', 'g') end as chave
  from public.conversations where contact_phone is not null
)
, k2 as (select * from k where chave <> '')
select user_id, count(*) as grupos_colididos
from (select user_id, chave from k2 group by 1, 2 having count(*) > 1) g
group by 1;

-- 3) Linhas que ficariam sem identificador (chave vazia e sem email) — também abortam a migration
select count(*) as sem_identificador
from public.conversations
where contact_phone is not null and regexp_replace(contact_phone, '\D', '', 'g') = '' and contact_email is null;
