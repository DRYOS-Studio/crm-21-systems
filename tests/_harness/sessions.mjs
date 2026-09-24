// 2 sessões `authenticated` pra testes de RLS/CRUD cruzado (AC-U3 e afins).
import { createClient } from "@supabase/supabase-js";
import { adminClient, apiUrlAndAnonKey } from "./db.mjs";

/** Cria um usuário confirmado via admin. Devolve {id, email, password}. */
export async function createUser(emailPrefix) {
  const admin = adminClient();
  const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = "senha-de-teste-" + Math.random().toString(36).slice(2, 10);
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser(${email}) falhou: ${error.message}`);
  return { id: data.user.id, email, password };
}

/** Client `@supabase/supabase-js` autenticado como esse usuário (anon key + sign-in). */
export async function createAuthenticatedClient(email, password) {
  const { url, anonKey } = apiUrlAndAnonKey();
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn(${email}) falhou: ${error.message}`);
  return { client, userId: data.user.id, session: data.session };
}

/** Atalho: cria e já autentica. */
export async function newTenant(emailPrefix) {
  const u = await createUser(emailPrefix);
  const s = await createAuthenticatedClient(u.email, u.password);
  return { userId: u.id, email: u.email, client: s.client };
}
