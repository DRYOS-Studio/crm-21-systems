import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { type LeadTag, type TagColor, normalizeTagName, nextTagColor } from "@/lib/lead-tags";

type LinkRow = { conversation_id: string; tag_id: string };

export function useLeadTags() {
  const { user } = useAuth();
  const [catalog, setCatalog] = useState<LeadTag[]>([]);
  const [byConv, setByConv] = useState<Record<string, LeadTag[]>>({});

  const reload = useCallback(async () => {
    if (!user) return;
    const [{ data: tags }, { data: links }] = await Promise.all([
      supabase.from("lead_tags").select("id, name, color").order("name"),
      supabase.from("conversation_tags").select("conversation_id, tag_id"),
    ]);
    const catalogRows = ((tags ?? []) as LeadTag[]).map((t) => ({
      ...t,
      color: t.color as TagColor,
    }));
    const map: Record<string, LeadTag> = {};
    for (const t of catalogRows) map[t.id] = t;
    const assigned: Record<string, LeadTag[]> = {};
    for (const row of (links ?? []) as LinkRow[]) {
      const tag = map[row.tag_id];
      if (!tag) continue;
      assigned[row.conversation_id] = [...(assigned[row.conversation_id] ?? []), tag];
    }
    setCatalog(catalogRows);
    setByConv(assigned);
  }, [user?.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createTag = useCallback(async (raw: string) => {
    if (!user) return null;
    const name = normalizeTagName(raw);
    if (!name) return null;
    const existing = catalog.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const { data, error } = await supabase
      .from("lead_tags")
      .insert({ user_id: user.id, name, color: nextTagColor(catalog.length) })
      .select("id, name, color")
      .single();
    if (error) throw new Error(error.message);
    const tag = { ...(data as LeadTag), color: data.color as TagColor };
    setCatalog((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
    return tag;
  }, [user, catalog]);

  const assign = useCallback(async (conversationId: string, tag: LeadTag) => {
    const { error } = await supabase
      .from("conversation_tags")
      .insert({ conversation_id: conversationId, tag_id: tag.id });
    if (error && error.code !== "23505") throw new Error(error.message);
    setByConv((prev) => {
      const cur = prev[conversationId] ?? [];
      if (cur.some((t) => t.id === tag.id)) return prev;
      return { ...prev, [conversationId]: [...cur, tag] };
    });
  }, []);

  const unassign = useCallback(async (conversationId: string, tagId: string) => {
    const { error } = await supabase
      .from("conversation_tags")
      .delete()
      .eq("conversation_id", conversationId)
      .eq("tag_id", tagId);
    if (error) throw new Error(error.message);
    setByConv((prev) => ({
      ...prev,
      [conversationId]: (prev[conversationId] ?? []).filter((t) => t.id !== tagId),
    }));
  }, []);

  return { catalog, byConv, reload, createTag, assign, unassign };
}
