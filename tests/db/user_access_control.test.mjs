import { test } from "node:test";
import assert from "node:assert/strict";
import { psql } from "../_harness/db.mjs";

function fixture() {
  const result = psql(`select c.user_id, peer.user_id, c.instance_id, c.id,
      shared.id, admin.user_id
    from public.conversations c
    join public.organization_members owner on owner.user_id = c.user_id
    join public.organization_members peer on peer.org_id = owner.org_id and peer.user_id <> owner.user_id
    join public.organization_member_modules pm on pm.org_id = peer.org_id and pm.user_id = peer.user_id and pm.module_key = 'crm_conversations'
    join public.organization_members admin_member on admin_member.org_id = owner.org_id
    join public.user_roles admin on admin.user_id = admin_member.user_id and admin.role = 'admin'
    join lateral (select id from public.conversations c0 where c0.user_id = owner.user_id and c0.instance_id is null limit 1) shared on true
    where c.instance_id is not null
      and exists (select 1 from public.organization_member_instances mi where mi.org_id=peer.org_id and mi.user_id=peer.user_id and mi.instance_id=c.instance_id)
    limit 1`).trim();
  assert.ok(result, "fixture local precisa de conversa atribuída, conversa compartilhada, peer e admin");
  const [owner, peer, instance, conversation, sharedConversation, admin] = result.split("|");
  return { owner, peer, instance, conversation, sharedConversation, admin };
}

function outreachFixture() {
  const result = psql(`select s.user_id, peer.user_id, s.instance_id, s.id
    from public.outreach_sends s
    join public.organization_members owner on owner.user_id=s.user_id
    join public.organization_members peer on peer.org_id=owner.org_id and peer.user_id<>owner.user_id
    join public.organization_member_modules pm on pm.org_id=peer.org_id and pm.user_id=peer.user_id and pm.module_key='prospecting'
    join public.organization_member_instances mi on mi.org_id=peer.org_id and mi.user_id=peer.user_id and mi.instance_id=s.instance_id
    where s.instance_id is not null limit 1`).trim();
  assert.ok(result, "fixture local precisa de histórico de prospecção associado a um device");
  const [owner, peer, instance, send] = result.split("|");
  return { owner, peer, instance, send };
}

test("T3: RLS limita conversas à instância e ao módulo; associação não pode ser removida", () => {
  const f = fixture();
  const out = psql(`
    begin;
    delete from public.organization_member_instances
      where user_id='${f.peer}'::uuid and instance_id='${f.instance}'::uuid;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"${f.peer}"}';
    select count(*) from public.conversations where id='${f.conversation}'::uuid;
    reset role;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"${f.owner}"}';
    select count(*) from public.conversations where id='${f.conversation}'::uuid;
    do $$ begin
      update public.conversations set instance_id = null where id='${f.conversation}'::uuid;
      raise exception 'expected assignment guard to reject update';
    exception when insufficient_privilege then null;
    end $$;
    reset role;
    delete from public.organization_member_modules
      where user_id='${f.peer}'::uuid and module_key='crm_conversations';
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"${f.peer}"}';
    select count(*) from public.conversations where id='${f.sharedConversation}'::uuid;
    reset role;
    insert into public.organization_member_modules(org_id,user_id,module_key)
      select org_id,'${f.peer}'::uuid,'crm_conversations'
      from public.organization_members where user_id='${f.peer}'::uuid
      on conflict do nothing;
    update public.organization_members set is_active=false where user_id='${f.peer}'::uuid;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"${f.peer}"}';
    select count(*) from public.conversations where id='${f.sharedConversation}'::uuid;
    reset role;
    select count(*) from public.conversations where id='${f.conversation}'::uuid;
    reset role;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"${f.admin}"}';
    select count(*) from public.conversations where id='${f.conversation}'::uuid;
    rollback;
  `).trim().split("\n").filter((line) => /^[01]$/.test(line));
  assert.deepEqual(out, ["0", "1", "0", "0", "1", "1"]);
});

test("T3: authenticated não lê credenciais nem administra grants; mídia e prospecção respeitam o device", () => {
  assert.equal(psql("select has_column_privilege('authenticated','public.whatsapp_instances','instance_token','select')").trim(), "f");
  assert.equal(psql("select has_column_privilege('authenticated','public.whatsapp_instances','server_url','select')").trim(), "f");
  assert.equal(psql("select has_table_privilege('authenticated','public.organization_member_instances','select')").trim(), "f");
  assert.equal(psql("select public = false from storage.buckets where id='chat-media'").trim(), "t");
  assert.equal(psql("select public = true from storage.buckets where id='organization-brand'").trim(), "t");

  const f = fixture();
  const rows = psql(`begin;
    delete from public.organization_member_instances where user_id='${f.peer}'::uuid and instance_id='${f.instance}'::uuid;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"${f.peer}"}';
    select count(*) from public.messages where conversation_id='${f.conversation}'::uuid;
    reset role;
    rollback;
  `).trim().split("\n").filter((line) => /^[01]$/.test(line));
  assert.deepEqual(rows, ["0"]);

  const mediaRows = psql(`begin;
    insert into storage.objects(bucket_id,name,owner_id,metadata)
    values ('chat-media','${f.instance}/access-test.bin','${f.owner}'::uuid,'{"mimetype":"text/plain","size":1}'::jsonb);
    delete from public.organization_member_instances where user_id='${f.peer}'::uuid and instance_id='${f.instance}'::uuid;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"${f.owner}"}';
    select count(*) from storage.objects where bucket_id='chat-media' and name='${f.instance}/access-test.bin';
    reset role;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"${f.peer}"}';
    select count(*) from storage.objects where bucket_id='chat-media' and name='${f.instance}/access-test.bin';
    reset role;
    rollback;
  `).trim().split("\n").filter((line) => /^[01]$/.test(line));
  assert.deepEqual(mediaRows, ["1", "0"]);

  const o = outreachFixture();
  const outreachRows = psql(`begin;
    delete from public.organization_member_instances where user_id='${o.peer}'::uuid and instance_id='${o.instance}'::uuid;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"${o.peer}"}';
    select count(*) from public.outreach_sends where id='${o.send}'::uuid;
    reset role;
    rollback;
  `).trim().split("\n").filter((line) => /^[01]$/.test(line));
  assert.deepEqual(outreachRows, ["0"]);
});

test("T4: operação administrativa grava grants juntos e rejeita dispositivos de outra organização", () => {
  const f = fixture();
  assert.equal(psql("select has_function_privilege('service_role','public.admin_save_member_access(uuid,uuid,boolean,text[],uuid[])','execute')").trim(), "t");
  assert.equal(psql("select has_function_privilege('authenticated','public.admin_save_member_access(uuid,uuid,boolean,text[],uuid[])','execute')").trim(), "f");
  assert.equal(psql("select has_function_privilege('anon','public.admin_save_member_access(uuid,uuid,boolean,text[],uuid[])','execute')").trim(), "f");
  const output = psql(`begin;
    select public.admin_save_member_access(
      '${f.admin}'::uuid, '${f.peer}'::uuid, true,
      array['crm','prospecting'], array['${f.instance}'::uuid]
    );
    select count(*) from public.organization_member_modules
      where user_id='${f.peer}'::uuid and module_key in ('crm_conversations','prospecting');
    select count(*) from public.organization_member_instances
      where user_id='${f.peer}'::uuid and instance_id='${f.instance}'::uuid;
    do $$ begin
      perform public.admin_save_member_access(
        '${f.admin}'::uuid, '${f.peer}'::uuid, true,
        array['unknown'], array[]::uuid[]
      );
      raise exception 'expected invalid module to fail';
    exception when sqlstate '22023' then null;
    end $$;
    do $$ begin
      perform public.admin_save_member_access(
        '${f.admin}'::uuid, '${f.peer}'::uuid, true,
        array['crm'], array['00000000-0000-0000-0000-000000000000']::uuid[]
      );
      raise exception 'expected foreign device to fail';
    exception when sqlstate '22023' then null;
    end $$;
    rollback;
  `).trim().split("\n").filter((line) => /^[012]$/.test(line));
  assert.deepEqual(output, ["2", "1"]);
});
