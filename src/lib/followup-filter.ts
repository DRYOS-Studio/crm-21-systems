export type FollowupConversationFields = {
  id: string;
  inactivity_followup_at?: string | null;
};

export function conversationHasFollowup(
  conv: FollowupConversationFields,
  pendingFollowupConversationIds: ReadonlySet<string>,
) {
  if (conv.inactivity_followup_at) return true;
  return pendingFollowupConversationIds.has(conv.id);
}
