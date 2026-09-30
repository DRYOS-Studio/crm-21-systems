import { useEffect, useState } from "react";
import { Building2, CircleSlash, Phone, StickyNote, Tag, Tags, User, CalendarClock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { LeadTagEditor } from "@/components/lead/LeadTagEditor";
import type { LeadTag } from "@/lib/lead-tags";
import { ConversationOwnerActions } from "@/components/org/ConversationOwnerActions";
import type { OrgMember } from "@/hooks/useOrgMembers";
import { toast } from "@/hooks/use-toast";
import type { Json } from "@/integrations/supabase/types";

export type LeadConversation = {
  id: string;
  contact_name: string | null;
  contact_company: string | null;
  contact_city: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  lead_context?: string | null;
  wa_phone?: string | null;
  installation_at?: string | null;
  custom_fields?: Json;
  qualification?: Json;
  confirmacoes?: number;
  ai_stage?: string;
};

type ProspectRow = {
  name: string | null;
  company: string | null;
  city: string | null;
  extra: Record<string, unknown> | null;
  origem: string | null;
};

export type LeadEditableFields = {
  contact_name?: string | null;
  contact_company?: string | null;
  contact_city?: string | null;
  contact_email?: string | null;
  lead_context?: string | null;
  installation_at?: string | null;
  custom_fields?: Record<string, string>;
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
  const userId = user?.id;
  const [prospect, setProspect] = useState<ProspectRow | null>(null);
  const [form, setForm] = useState({ name: "", company: "", city: "", email: "" });
  const [leadContext, setLeadContext] = useState("");
  const [installationAt, setInstallationAt] = useState("");
  const [customDefinitions, setCustomDefinitions] = useState<{ label: string; field_key: string }[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) return;
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
  }, [userId, conversation.id, conversation.contact_phone, conversation.wa_phone]);

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

  useEffect(() => {
    if (!userId) return;
    void supabase.from("lead_custom_fields").select("label, field_key").order("label")
      .then(({ data }) => setCustomDefinitions(data ?? []));
  }, [userId]);

  useEffect(() => {
    const values = conversation.custom_fields;
    setCustomValues(values && typeof values === "object" && !Array.isArray(values) ? values as Record<string, string> : {});
    setInstallationAt(conversation.installation_at
      ? new Date(new Date(conversation.installation_at).getTime() - new Date(conversation.installation_at).getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
      : "");
  }, [conversation.id, conversation.custom_fields, conversation.installation_at]);

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

  const saveOperations = async () => {
    setSaving(true);
    const value = installationAt ? new Date(installationAt).toISOString() : null;
    const { error } = await supabase.from("conversations").update({ installation_at: value, custom_fields: customValues }).eq("id", conversation.id);
    setSaving(false);
    if (error) {
      toast({ variant: "destructive", title: "Erro ao salvar operação", description: error.message });
      return;
    }
    onSaved?.({ installation_at: value, custom_fields: customValues });
    toast({ title: "Dados operacionais salvos" });
  };

  const qualification = conversation.qualification && typeof conversation.qualification === "object" && !Array.isArray(conversation.qualification)
    ? conversation.qualification as Record<string, unknown> : {};

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

        <Accordion type="multiple" defaultValue={["perfil", "operacao"]} className="w-full">
          <AccordionItem value="perfil">
            <AccordionTrigger className="py-3 hover:no-underline">
              <SectionHeading icon={User} label="Perfil" />
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pb-4">
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
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="contato">
            <AccordionTrigger className="py-3 hover:no-underline">
              <SectionHeading icon={Phone} label="Contato" />
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pb-4">
            <Field icon={Phone} label="WhatsApp" value={phone} />
            <div className="space-y-1.5">
              <Label htmlFor={`lead-email-${conversation.id}`}>E-mail</Label>
              <Input id={`lead-email-${conversation.id}`} type="email" value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} />
            </div>
            {importedName && importedName !== form.name && <Field icon={User} label="Nome importado" value={importedName} />}
            <Field icon={User} label="Nome no WhatsApp" value={person && person !== importedName ? person : null} />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="operacao">
            <AccordionTrigger className="py-3 hover:no-underline">
              <SectionHeading icon={Tags} label="Operação" />
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pb-4">
              <div className="space-y-1.5">
                <Label htmlFor={`install-at-${conversation.id}`}>Data e hora da instalação</Label>
                <Input id={`install-at-${conversation.id}`} type="datetime-local" value={installationAt} onChange={(e) => setInstallationAt(e.target.value)} />
              </div>
              {customDefinitions.map((field) => (
                <div key={field.field_key} className="space-y-1.5">
                  <Label htmlFor={`custom-${conversation.id}-${field.field_key}`}>{field.label}</Label>
                  <Input id={`custom-${conversation.id}-${field.field_key}`} value={customValues[field.field_key] ?? ""} onChange={(e) => setCustomValues((prev) => ({ ...prev, [field.field_key]: e.target.value }))} />
                </div>
              ))}
              {(customDefinitions.length > 0 || installationAt || conversation.installation_at) && <Button className="w-full" variant="outline" onClick={() => void saveOperations()} disabled={saving}>Salvar operação</Button>}
              <div className="rounded-md border p-3 space-y-2">
                <SectionHeading icon={CalendarClock} label="Qualificação NAVT" />
                <p className="text-xs"><span className="text-muted-foreground">Estado: </span>{conversation.ai_stage || "inicial"}</p>
                {Object.entries(qualification).filter(([, value]) => value != null && String(value).trim() !== "").map(([key, value]) => <div key={key} className="text-xs"><span className="text-muted-foreground">{key}: </span>{String(value)}</div>)}
                {Object.keys(qualification).length === 0 && <p className="text-xs text-muted-foreground">Ainda sem dados de qualificação.</p>}
                <p className="text-[11px] text-muted-foreground">Confirmações de promessa: {conversation.confirmacoes ?? 0}</p>
              </div>
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
            </AccordionContent>
          </AccordionItem>

          {extraEntries.length > 0 && (
            <AccordionItem value="importacao">
              <AccordionTrigger className="py-3 hover:no-underline">
                <SectionHeading icon={Tag} label="Importação" />
              </AccordionTrigger>
              <AccordionContent className="space-y-3 pb-4">
                {extraEntries.map(([k, v]) => (
                  <div key={k} className="space-y-0.5">
                    <div className="text-[11px] text-muted-foreground">{k}</div>
                    <div className="text-sm break-words">{String(v)}</div>
                  </div>
                ))}
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>

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
