import { supabase } from "@/integrations/supabase/client";
import { transferConversationErrorMessage } from "@/lib/transfer-conversation-errors";

export { transferConversationErrorMessage } from "@/lib/transfer-conversation-errors";

export async function transferConversation(
  conversationId: string,
  toUserId: string,
  stageId?: string | null,
) {
  const { data, error } = await supabase.rpc("transfer_conversation", {
    p_conversation_id: conversationId,
    p_to_user: toUserId,
    p_stage_id: stageId ?? null,
  });
  if (error) {
    throw new Error(transferConversationErrorMessage(error.message));
  }
  const row = data as { ok?: boolean; user_id?: string; stage_id?: string | null; instance_id?: string | null } | null;
  if (!row?.ok) throw new Error("Não foi possível transferir.");
  return row;
}
