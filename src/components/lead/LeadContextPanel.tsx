import { useEffect, useState } from "react";
import { Building2, CircleSlash, Phone, Tag, Tags, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  }, [conversation.id, conversation.contact_name, conversation.contact_company, conversation.contact_city, conversation.contact_email, prospect?.name, prospect?.company, prospect?.city]);

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

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Lead</div>
        <div className="font-semibold text-sm mt-0.5">{company || importedName || person || leadTitle(conversation)}</div>
        {prospect?.origem && (
          <Badge variant="secondary" className="mt-2 text-[10px]">
            {prospect.origem}
          </Badge>
        )}
      </div>

      {lossLabel && (
        <>
          <Separator />
          <Field icon={CircleSlash} label="Motivo da perda" value={lossLabel} />
        </>
      )}

      {ownerUserId && orgMembers && orgMembers.length > 1 && onTransfer && (
        <>
          <Separator />
          <ConversationOwnerActions
            ownerUserId={ownerUserId}
            members={orgMembers}
            currentUserId={currentUserId}
            onTransfer={onTransfer}
          />
        </>
      )}

      <Separator />

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`lead-name-${conversation.id}`}>Nome</Label>
          <Input id={`lead-name-${conversation.id}`} value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`lead-company-${conversation.id}`}>Empresa</Label>
          <Input id={`lead-company-${conversation.id}`} value={form.company} onChange={(e) => setForm((prev) => ({ ...prev, company: e.target.value }))} />
        </div>
        {importedName && importedName !== form.name && (
          <Field icon={User} label="Nome importado" value={importedName} />
        )}
        <Field
          icon={User}
          label="Nome no WhatsApp"
          value={person && person !== importedName ? person : null}
        />
        <div className="space-y-1.5">
          <Label htmlFor={`lead-city-${conversation.id}`}>Cidade</Label>
          <Input id={`lead-city-${conversation.id}`} value={form.city} onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))} />
        </div>
        <Field icon={Phone} label="WhatsApp" value={phone} />
        <div className="space-y-1.5">
          <Label htmlFor={`lead-email-${conversation.id}`}>E-mail</Label>
          <Input id={`lead-email-${conversation.id}`} type="email" value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} />
        </div>
        <Button className="w-full" onClick={() => void saveLead()} disabled={saving}>
          {saving ? "Salvando…" : "Salvar dados"}
        </Button>
      </div>

      {tags && (
        <>
          <Separator />
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              <Tags className="w-3 h-3" />
              Tags
            </div>
            <LeadTagEditor
              conversationId={conversation.id}
              catalog={tags.catalog}
              assigned={tags.assigned}
              createTag={tags.createTag}
              assign={tags.assign}
              unassign={tags.unassign}
            />
          </div>
        </>
      )}

      {extraEntries.length > 0 && (
        <>
          <Separator />
          <div className="space-y-3">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              <Tag className="w-3 h-3" />
              Dados da importação
            </div>
            {extraEntries.map(([k, v]) => (
              <div key={k} className="space-y-0.5">
                <div className="text-[11px] text-muted-foreground">{k}</div>
                <div className="text-sm break-words">{String(v)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {!company && !importedName && !city && extraEntries.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Sem ficha importada. Empresa e cidade entram pelo CSV ou pelo Extrator.
        </p>
      )}
    </div>
  );
}
