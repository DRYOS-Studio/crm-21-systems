import { useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { tagBadgeVariant, type LeadTag } from "@/lib/lead-tags";

type Props = {
  conversationId: string;
  catalog: LeadTag[];
  assigned: LeadTag[];
  createTag: (name: string) => Promise<LeadTag | null>;
  assign: (conversationId: string, tag: LeadTag) => Promise<void>;
  unassign: (conversationId: string, tagId: string) => Promise<void>;
};

export function LeadTagEditor({ conversationId, catalog, assigned, createTag, assign, unassign }: Props) {
  const [draft, setDraft] = useState("");
  const assignedIds = new Set(assigned.map((t) => t.id));
  const suggestions = catalog.filter((t) => !assignedIds.has(t.id)).slice(0, 8);

  const add = async (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    try {
      const tag = await createTag(name);
      if (tag) await assign(conversationId, tag);
      setDraft("");
    } catch (e: unknown) {
      toast({ variant: "destructive", title: "Tag", description: e instanceof Error ? e.message : "Falha" });
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {assigned.map((t) => (
          <Badge key={t.id} variant={tagBadgeVariant(t.color)} className="gap-1 pr-1">
            {t.name}
            <button
              type="button"
              className="rounded-full p-0.5 hover:bg-background/40"
              onClick={() => void unassign(conversationId, t.id)}
              aria-label={`Remover ${t.name}`}
            >
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}
        {assigned.length === 0 && (
          <span className="text-xs text-muted-foreground">Nenhuma tag ainda</span>
        )}
      </div>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Nova tag e Enter"
        className="h-8 text-xs"
        maxLength={32}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void add(draft);
          }
        }}
      />
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestions.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => void assign(conversationId, t)}
              className="text-left"
            >
              <Badge variant={tagBadgeVariant(t.color)} className="cursor-pointer opacity-80 hover:opacity-100">
                + {t.name}
              </Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function LeadTagChips({ tags, max = 3 }: { tags: LeadTag[]; max?: number }) {
  if (!tags.length) return null;
  const shown = tags.slice(0, max);
  const extra = tags.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((t) => (
        <Badge key={t.id} variant={tagBadgeVariant(t.color)}>
          {t.name}
        </Badge>
      ))}
      {extra > 0 && (
        <Badge variant="neutral">+{extra}</Badge>
      )}
    </div>
  );
}

export { TagFilterSelect, TagFiltersControl } from "@/components/lead/TagFiltersControl";
