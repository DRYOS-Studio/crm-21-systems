import { useEffect, useState } from "react";
import { Building2, CircleSlash, Phone, StickyNote, Tag, Tags, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LeadTagEditor } from "@/components/lead/LeadTagEditor";
import type { LeadTag } from "@/lib/lead-tags";
import { ConversationOwnerActions } from "@/components/org/ConversationOwnerActions";
import type { OrgMember } from "@/hooks/useOrgMembers";
import { toast } from "@/hooks/use-toast";

export type LeadConversation = {
  id: string;
  contact_name: string | null;
  contact_company: string | null;
  contact_city: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  lead_context?: string | null;
  wa_phone?: string | null;
};

type ProspectRow = {
  name: string | null;
  company: string | null;
  city: string | null;
  extra: Record<string, unknown> | null;
  origem: string | null;
};

export type LeadEditableFields = {
  contact_name: string | null;
  contact_company: string | null;
  contact_city: string | null;
  contact_email: string | null;
  lead_context?: string | null;
};

export function leadTitle(c: LeadConversation) {
  return c.contact_company || c.contact_name || c.contact_phone || c.contact_email || "Lead";
}

export function leadPerson(c: LeadConversation) {
  if (c.contact_name && c.contact_name !== c.contact_company) return c.contact_name;
  return null;
}

function Field({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Building2;
  label: string;
  value?: string | null;
}) {
  if (!value) return null;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className="text-sm text-foreground break-words">{value}</div>
    </div>
  );
}

function SectionHeading({ icon: Icon, label }: { icon: typeof Building2; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </div>
  );
}

type TagTools = {
  catalog: LeadTag[];
  assigned: LeadTag[];
  createTag: (name: string) => Promise<LeadTag | null>;
  assign: (conversationId: string, tag: LeadTag) => Promise<void>;
  unassign: (conversationId: string, tagId: string) => Promise<void>;
};

export function LeadContextBody({
  conversation,
  tags,
  lossLabel,
  ownerUserId,
  orgMembers,
  currentUserId,
  onTransfer,
  onSaved,
}: {
  conversation: LeadConversation;
  tags?: TagTools;
  lossLabel?: string | null;
  ownerUserId?: string;
  orgMembers?: OrgMember[];
  currentUserId?: string | null;
  onTransfer?: () => void;
  onSaved?: (fields: LeadEditableFields) => void;
}) {
  const { user } = useAuth();
  const [prospect, setProspect] = useState<ProspectRow | null>(null);
  const [form, setForm] = useState({ name: "", company: "", city: "", email: "" });
  const [leadContext, setLeadContext] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      const phone = conversation.contact_phone || conversation.wa_phone;
      const byId = await supabase
        .from("prospects")
        .select("name, company, city, extra, origem")
        .eq("conversation_id", conversation.id)
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (byId.data) {
        setProspect(byId.data as ProspectRow);
        return;
      }
      if (!phone) {
        setProspect(null);
        return;
      }
      const byPhone = await supabase
        .from("prospects")
        .select("name, company, city, extra, origem")
        .eq("phone", phone)
        .limit(1)
        .maybeSingle();
      if (!cancelled) setProspect((byPhone.data as ProspectRow | null) ?? null);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [user?.id, conversation.id, conversation.contact_phone, conversation.wa_phone]);

  const company = conversation.contact_company || prospect?.company || null;
  const importedName = prospect?.name || null;
  const person = leadPerson(conversation);
  const city = conversation.contact_city || prospect?.city || null;
  const phone = conversation.wa_phone || conversation.contact_phone;
  const extra = prospect?.extra && typeof prospect.extra === "object" ? prospect.extra : null;
  const extraEntries = extra
    ? Object.entries(extra).filter(([, v]) => v != null && String(v).trim() !== "")
    : [];

  useEffect(() => {
    setForm({
      name: conversation.contact_name || prospect?.name || "",
      company: conversation.contact_company || prospect?.company || "",
      city: conversation.contact_city || prospect?.city || "",
      email: conversation.contact_email || "",
    });
    setLeadContext(conversation.lead_context || "");
  }, [conversation.id, conversation.contact_name, conversation.contact_company, conversation.contact_city, conversation.contact_email, conversation.lead_context, prospect?.name, prospect?.company, prospect?.city]);

  const saveLead = async () => {
    setSaving(true);
    const fields: LeadEditableFields = {
      contact_name: form.name.trim() || null,
      contact_company: form.company.trim() || null,
      contact_city: form.city.trim() || null,
      contact_email: form.email.trim() || null,
    };
    const { error } = await supabase.from("conversations").update(fields).eq("id", conversation.id);
    setSaving(false);
    if (error) {
      toast({ variant: "destructive", title: "Erro ao salvar dados do lead", description: error.message });
      return;
    }
    onSaved?.(fields);
    toast({ title: "Dados do lead salvos" });
  };

  const saveLeadContext = async () => {
    setSaving(true);
    const value = leadContext.trim() || null;
    const { error } = await supabase
      .from("conversations")
      .update({ lead_context: value })
      .eq("id", conversation.id);
    setSaving(false);
    if (error) {
      toast({ variant: "destructive", title: "Erro ao salvar anotações", description: error.message });
      return;
    }
    onSaved?.({ lead_context: value });
    toast({ title: "Anotações salvas" });
  };

  return (
    <Tabs defaultValue="informacoes" className="space-y-4">
      <TabsList className="grid h-9 w-full grid-cols-2">
        <TabsTrigger value="informacoes" className="text-xs">Informações</TabsTrigger>
        <TabsTrigger value="anotacoes" className="text-xs">Anotações</TabsTrigger>
      </TabsList>

      <TabsContent value="informacoes" className="space-y-5">
        <div className="space-y-1">
          <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Lead selecionado</div>
          <div className="text-base font-semibold leading-tight">{company || importedName || person || leadTitle(conversation)}</div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {person && person !== company && <span>{person}</span>}
            {city && <span>{person && person !== company ? "·" : ""} {city}</span>}
            {prospect?.origem && <Badge variant="secondary" className="text-[10px]">{prospect.origem}</Badge>}
          </div>
        </div>

        <Separator />

        <section className="space-y-3">
          <SectionHeading icon={User} label="Perfil" />
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`lead-name-${conversation.id}`}>Nome</Label>
              <Input id={`lead-name-${conversation.id}`} value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`lead-company-${conversation.id}`}>Empresa</Label>
              <Input id={`lead-company-${conversation.id}`} value={form.company} onChange={(e) => setForm((prev) => ({ ...prev, company: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`lead-city-${conversation.id}`}>Cidade</Label>
              <Input id={`lead-city-${conversation.id}`} value={form.city} onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))} />
            </div>
            <Button className="w-full" onClick={() => void saveLead()} disabled={saving}>
              {saving ? "Salvando…" : "Salvar perfil"}
            </Button>
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <SectionHeading icon={Phone} label="Contato" />
          <div className="space-y-3">
            <Field icon={Phone} label="WhatsApp" value={phone} />
            <div className="space-y-1.5">
              <Label htmlFor={`lead-email-${conversation.id}`}>E-mail</Label>
              <Input id={`lead-email-${conversation.id}`} type="email" value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} />
            </div>
            {importedName && importedName !== form.name && <Field icon={User} label="Nome importado" value={importedName} />}
            <Field icon={User} label="Nome no WhatsApp" value={person && person !== importedName ? person : null} />
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <SectionHeading icon={Tags} label="Operação" />
          {lossLabel && <Field icon={CircleSlash} label="Motivo da perda" value={lossLabel} />}
          {ownerUserId && orgMembers && orgMembers.length > 1 && onTransfer && (
            <ConversationOwnerActions
              ownerUserId={ownerUserId}
              members={orgMembers}
              currentUserId={currentUserId}
              onTransfer={onTransfer}
            />
          )}
          {tags && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Tags</div>
              <LeadTagEditor
                conversationId={conversation.id}
                catalog={tags.catalog}
                assigned={tags.assigned}
                createTag={tags.createTag}
                assign={tags.assign}
                unassign={tags.unassign}
              />
            </div>
          )}
        </section>

        {extraEntries.length > 0 && (
          <>
            <Separator />
            <section className="space-y-3">
              <SectionHeading icon={Tag} label="Importação" />
              {extraEntries.map(([k, v]) => (
                <div key={k} className="space-y-0.5">
                  <div className="text-[11px] text-muted-foreground">{k}</div>
                  <div className="text-sm break-words">{String(v)}</div>
                </div>
              ))}
            </section>
          </>
        )}

        {!company && !importedName && !city && extraEntries.length === 0 && (
          <p className="text-xs text-muted-foreground">Sem ficha importada. Empresa e cidade entram pelo CSV ou pelo Extrator.</p>
        )}
      </TabsContent>

      <TabsContent value="anotacoes" className="space-y-4">
        <div className="space-y-1">
          <SectionHeading icon={StickyNote} label="Contexto do lead" />
          <p className="text-xs text-muted-foreground">
            Registre dores, objetivos, cenário e informações importantes para uma futura proposta.
          </p>
        </div>
        <Textarea
          value={leadContext}
          onChange={(e) => setLeadContext(e.target.value)}
          placeholder="Ex.: principal desafio, objetivo, prazo, orçamento, decisores…"
          className="min-h-[220px] resize-y text-sm"
        />
        <Button className="w-full" onClick={() => void saveLeadContext()} disabled={saving}>
          {saving ? "Salvando…" : "Salvar anotações"}
        </Button>
      </TabsContent>
    </Tabs>
  );
}
