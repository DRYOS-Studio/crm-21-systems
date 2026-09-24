import { useEffect, useState } from "react";
import { BookOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { Tables } from "@/integrations/supabase/types";

type Topic = Tables<"knowledge_base">;

function isDuplicateTopic(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "23505" || /knowledge_base.*topic|unique.*topic/i.test(error.message || "");
}

export function KnowledgeBaseSection({ open }: { open: boolean }) {
  const { user } = useAuth();
  const [items, setItems] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [formError, setFormError] = useState("");

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("knowledge_base")
      .select("*")
      .eq("user_id", user.id)
      .order("topic");
    setLoading(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setItems(data ?? []);
  };

  useEffect(() => {
    if (!open) return;
    setFormOpen(false);
    setEditingId(null);
    setFormError("");
    void load();
  }, [open, user?.id]);

  const resetForm = () => {
    setTopic("");
    setTitle("");
    setContent("");
    setEditingId(null);
    setFormOpen(false);
    setFormError("");
  };

  const startAdd = () => {
    setTopic("");
    setTitle("");
    setContent("");
    setEditingId(null);
    setFormError("");
    setFormOpen(true);
  };

  const startEdit = (row: Topic) => {
    setTopic(row.topic);
    setTitle(row.title ?? "");
    setContent(row.content);
    setEditingId(row.id);
    setFormError("");
    setFormOpen(true);
  };

  const save = async () => {
    if (!user) return;
    const t = topic.trim();
    const c = content.trim();
    if (!t || !c) {
      setFormError("Tópico e conteúdo são obrigatórios.");
      return;
    }
    setSaving(true);
    setFormError("");
    const payload = {
      topic: t,
      title: title.trim() || null,
      content: c,
      user_id: user.id,
    };
    const { error } = editingId
      ? await supabase.from("knowledge_base").update(payload).eq("id", editingId).eq("user_id", user.id)
      : await supabase.from("knowledge_base").insert(payload);
    setSaving(false);
    if (isDuplicateTopic(error)) {
      setFormError("tópico já existe");
      return;
    }
    if (error) {
      setFormError(error.message);
      return;
    }
    resetForm();
    await load();
  };

  const remove = async (row: Topic) => {
    if (!user) return;
    setSaving(true);
    setFormError("");
    const { error } = await supabase.from("knowledge_base").delete().eq("id", row.id).eq("user_id", user.id);
    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    if (editingId === row.id) resetForm();
    await load();
  };

  return (
    <section className="dryos space-y-4 rounded-lg border border-border bg-card p-5">
      <h3 className="font-semibold text-sm flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-primary" /> Base de conhecimento
      </h3>
      <p className="text-xs text-muted-foreground">
        Tópicos que a IA consulta no modo novo. O nome é gravado em minúsculas.
      </p>

      {loading && items.length === 0 && !formOpen ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : items.length === 0 && !formOpen ? (
        <div id="kb-empty" className="space-y-3">
          <p className="text-xs text-muted-foreground">nenhum tópico ainda</p>
          <Button id="kb-add" type="button" size="sm" onClick={startAdd} disabled={saving}>
            <Plus className="w-4 h-4 mr-1" />
            Adicionar
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((row) => (
            <li
              key={row.id}
              data-topic={row.topic}
              className="flex items-start justify-between gap-2 rounded-md border border-border bg-background px-3 py-2"
            >
              <div className="min-w-0 space-y-1">
                <Badge variant="oak">{row.topic}</Badge>
                {row.title && <p className="text-xs font-medium truncate">{row.title}</p>}
                <p className="text-xs text-muted-foreground line-clamp-2">{row.content}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Editar ${row.topic}`}
                  disabled={saving}
                  onClick={() => startEdit(row)}
                >
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remover ${row.topic}`}
                  disabled={saving}
                  onClick={() => void remove(row)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && !formOpen && (
        <Button id="kb-add" type="button" variant="outline" size="sm" onClick={startAdd} disabled={saving}>
          <Plus className="w-4 h-4 mr-1" />
          Adicionar
        </Button>
      )}

      {formOpen && (
        <div className="space-y-3 border-t border-border pt-3">
          <div className="space-y-1.5">
            <Label htmlFor="kb-topic" className="text-xs">
              Tópico
            </Label>
            <Input
              id="kb-topic"
              value={topic}
              onChange={(e) => {
                setTopic(e.target.value);
                if (formError) setFormError("");
              }}
              placeholder="Ex.: Preços"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kb-title" className="text-xs">
              Título (opcional)
            </Label>
            <Input id="kb-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kb-content" className="text-xs">
              Conteúdo
            </Label>
            <Textarea
              id="kb-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              placeholder="O que a IA deve responder sobre este tópico."
            />
          </div>
          {formError && (
            <p id="kb-error" className="text-xs text-destructive" role="alert">
              {formError}
            </p>
          )}
          <div className="flex gap-2">
            <Button id="kb-save" type="button" size="sm" onClick={() => void save()} disabled={saving}>
              {saving ? "Salvando..." : editingId ? "Atualizar" : "Salvar tópico"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={resetForm} disabled={saving}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
