import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, MailPlus, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type Instance = { id: string; name: string; phone: string | null; status: string };
type Member = {
  user_id: string;
  is_active: boolean;
  access_review_required: boolean;
  role: string;
  profile: { email: string | null; full_name: string | null } | null;
  module_keys: string[];
  instance_ids: string[];
};

const CRM_MODULE = "crm_conversations";

export default function SettingsUsuariosPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState("");
  const [editing, setEditing] = useState<Member | null>(null);
  const [active, setActive] = useState(true);
  const [modules, setModules] = useState<string[]>([]);
  const [instanceIds, setInstanceIds] = useState<string[]>([]);

  const call = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("manage-organization-members", { body });
    if (error) throw new Error(error.message);
    if (!data?.ok) throw new Error(data?.error || "A operação falhou");
    return data;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await call({ action: "list" });
      setMembers(data.members ?? []);
      setInstances(data.instances ?? []);
    } catch (error) {
      toast({ variant: "destructive", title: "Erro ao carregar usuários", description: (error as Error).message });
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => { void load(); }, [load]);

  const openEditor = (member: Member) => {
    setEditing(member);
    setActive(member.is_active);
    setModules(member.module_keys);
    setInstanceIds(member.instance_ids);
  };

  const toggle = (values: string[], setValues: (next: string[]) => void, value: string) => {
    setValues(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  };

  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await call({ action: "invite", email });
      setEmail("");
      await load();
      toast({ title: "Convite enviado", description: "O novo usuário entra sem módulos ou dispositivos até a concessão do admin." });
    } catch (error) {
      toast({ variant: "destructive", title: "Erro ao convidar", description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await call({
        action: "save_access",
        user_id: editing.user_id,
        is_active: active,
        module_keys: modules,
        instance_ids: instanceIds,
      });
      setEditing(null);
      await load();
      toast({ title: "Acessos atualizados" });
    } catch (error) {
      toast({ variant: "destructive", title: "Erro ao salvar acessos", description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const resend = async (member: Member) => {
    setSaving(true);
    try {
      await call({ action: "resend_invite", user_id: member.user_id });
      toast({ title: "Link enviado", description: `Verifique a caixa de entrada de ${member.profile?.email || "do usuário"}.` });
    } catch (error) {
      toast({ variant: "destructive", title: "Erro ao enviar link", description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-6">
      <header className="flex items-start gap-3">
        <Users className="mt-1 h-5 w-5 text-primary" />
        <div>
          <h2 className="text-lg font-semibold">Usuários e acessos</h2>
          <p className="text-sm text-muted-foreground">Conceda módulos e dispositivos WhatsApp por usuário.</p>
        </div>
      </header>

      <form onSubmit={invite} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor="member-email">Convidar usuário</Label>
          <Input id="member-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nome@empresa.com" />
        </div>
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MailPlus className="mr-2 h-4 w-4" />}
          Enviar convite
        </Button>
      </form>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Membros</h3>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" /> Atualizar
          </Button>
        </div>
        {loading ? <p className="text-sm text-muted-foreground">Carregando…</p> : members.map((member) => {
          const title = member.profile?.full_name || member.profile?.email || member.user_id;
          return (
            <article key={member.user_id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-medium">{title}</p>
                {member.profile?.full_name && <p className="truncate text-sm text-muted-foreground">{member.profile.email}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant={member.is_active ? "secondary" : "outline"}>{member.is_active ? "Ativo" : "Desativado"}</Badge>
                  {member.role === "admin" && <Badge>Admin · acesso total</Badge>}
                  {member.access_review_required && <Badge variant="outline">Revisar acessos herdados</Badge>}
                  {member.role !== "admin" && <Badge variant="outline">{member.instance_ids.length} dispositivos</Badge>}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" onClick={() => void resend(member)} disabled={saving}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Enviar link
                </Button>
                <Button size="sm" onClick={() => openEditor(member)}>Gerenciar</Button>
              </div>
            </article>
          );
        })}
        {!loading && members.length === 0 && <p className="text-sm text-muted-foreground">Nenhum membro encontrado.</p>}
      </div>

      {editing && <div className="space-y-5 rounded-lg border border-primary/30 bg-muted/20 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold">Acessos de {editing.profile?.full_name || editing.profile?.email || "usuário"}</h3>
            <p className="text-sm text-muted-foreground">{editing.profile?.email}</p>
          </div>
          {editing.access_review_required && <Badge variant="outline">Acesso herdado; revise e salve</Badge>}
        </div>

        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
          Usuário ativo
        </label>

        {editing.role === "admin" ? <p className="text-sm text-muted-foreground">Admins têm acesso total; o papel não pode ser alterado por esta tela.</p> : <>
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Módulos</h4>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={modules.includes(CRM_MODULE)} onChange={() => toggle(modules, setModules, CRM_MODULE)} />
              CRM e Conversas · inclui Agenda e Dashboard
            </label>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={modules.includes("prospecting")} onChange={() => toggle(modules, setModules, "prospecting")} />
              Prospecção
            </label>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-medium">Dispositivos WhatsApp</h4>
            {instances.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma instância cadastrada.</p> : instances.map((instance) => (
              <label key={instance.id} className="flex items-center gap-3 text-sm">
                <input type="checkbox" checked={instanceIds.includes(instance.id)} onChange={() => toggle(instanceIds, setInstanceIds, instance.id)} />
                <span>{instance.name}{instance.phone ? ` · ${instance.phone}` : ""}</span>
                <span className="text-muted-foreground">{instance.status}</span>
              </label>
            ))}
          </div>
        </>}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            Salvar acessos
          </Button>
        </div>
      </div>}
    </section>
  );
}
