const ERROR_PT: Record<string, string> = {
  not_authenticated: "Faça login novamente.",
  invalid_target: "Escolha quem vai receber a conversa.",
  target_not_in_org: "Esse usuário não faz parte do seu time.",
  conversation_not_found: "Conversa não encontrada.",
  forbidden: "Sem permissão para transferir esta conversa.",
  duplicate_contact: "Quem você escolheu já tem este contato no inbox.",
  invalid_stage: "Escolha uma etapa válida do funil de quem vai receber.",
  stage_required: "Escolha em qual etapa do funil a conversa deve ficar.",
};

export function transferConversationErrorMessage(raw: string | undefined): string {
  if (!raw) return "Não foi possível transferir.";
  for (const [code, msg] of Object.entries(ERROR_PT)) {
    if (raw.includes(code)) return msg;
  }
  return raw;
}
