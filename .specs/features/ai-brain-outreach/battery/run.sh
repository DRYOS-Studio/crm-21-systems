#!/bin/bash
# Uso: ./run.sh  → baseline sobre o brain.ts REAL + cada mutação sobre cópia mutada
set -u; D=$(cd "$(dirname "$0")" && pwd); SRC="$D/../../../../supabase/functions/_shared"
run() { BRAIN="$1" node --no-warnings --import "$D/register.mjs" "$D/tests.mjs"; }
echo "BASELINE (arquivo de produção)"; run "$SRC/brain.ts"
mut() { local id="$1" from="$2" to="$3"; local M="$D/mut/$id"; rm -rf "$M"; mkdir -p "$M"; cp "$SRC/brain.ts" "$SRC/cerebro.ts" "$M/";
  python3 - "$M/brain.ts" "$from" "$to" <<'PY'
import sys; p,a,b=sys.argv[1:]; s=open(p).read(); assert s.count(a)==1, "mutacao nao aplicou: "+a; open(p,'w').write(s.replace(a,b))
PY
  # Sem checar isto, uma âncora desatualizada falha em silêncio (sem `set -e`): o mutante fica
  # idêntico ao baseline e "sobrevive" por não ter sido mutado — achado real em T11.
  if [ $? -ne 0 ]; then echo "ABORT $id: âncora não bateu (código-fonte mudou desde que a mutação foi escrita)"; exit 1; fi
  echo "MUT $id"; run "$M/brain.ts"; }
mut M1-sem-nao-resposta 'return limpo.length < 2 || NAO_RESPOSTA.test(limpo);' 'return limpo.length < 2;'
mut M2a-sem-rebaixa 'const etapa = r.etapa === "convidar" && falta.length ? "descobrir" : r.etapa || conversa.etapa;' 'const etapa = r.etapa || conversa.etapa;'
mut M2b-sem-reprompt 'if (r.etapa === "convidar" && falta.length) {' 'if (false) {'
mut M3-escala-em-3 'return n >= 2;' 'return n >= 3;'
mut M4-fuso-utc 'const FUSO_HORAS = -3;' 'const FUSO_HORAS = 0;'
mut M5-kb-sem-tenant '      .eq("user_id", userId)
      .eq("topic", chave)' '      .eq("topic", chave)'
mut M5b-lista-sem-tenant '      .select("topic")
      .eq("user_id", userId);' '      .select("topic");'
mut M6-teto-40 'const MAX_RODADAS_TOOL = 4;' 'const MAX_RODADAS_TOOL = 40;'
mut M7-sem-slice '(r.mensagens || []).slice(0, 2).filter' '(r.mensagens || []).filter'
mut M8-sem-checagem-shape 'return j !== null && Array.isArray(j.mensagens);' 'return j !== null;'
mut M1b-sem-interrogacao '|\?+|' '|'
mut M1c-sem-na '|n\/?a|' '|'
mut M9-reprompt-sem-recusa '## O SISTEMA RECUSOU A SUA ÚLTIMA RESPOSTA' '## NOTA'
mut M10-falta-sem-merge 'let dados = mesclarDados(conversa.dados, qualificacaoDoTurno);' 'let dados = mesclarDados(conversa.dados, {});'
mut M11-conta-sem-promessa 'const n = (conversa.confirmacoes || 0) + (prometeu ? 1 : 0);' 'const n = (conversa.confirmacoes || 0) + 1;'
mut M11b-escala-em-1 'return n >= 2;' 'return n >= 1;'
# T11: janela virou parâmetro de verdade (D5) — M12-M16 (regex/escopo sobre historyMessages,
# heurísticas de posição) ficam obsoletas por essa mudança de arquitetura; consolidadas nesta
# única mutação, que ignora o parâmetro `janela` e recalcula o escopo a partir do histórico
# inteiro (o próprio bug que M12/M13 testavam). Precisa matar em AC-A4w E AC-A5w (mensagem
# antiga voltaria a disparar humano/optout).
mut M12-janela-ignorada 'const { admin, userId, agent, conversa, historyMessages, janela } = params;' 'const { admin, userId, agent, conversa, historyMessages } = params; const janela = historyMessages.filter((m) => m.role === "user").map((m) => m.content);'
# T12 (ADR-01): tools nunca leva response_format — a Groq rejeita a combinação (AC-A0, medido).
mut M13-tools-com-response-format 'const r = await callGroq(apiKey, model, mensagens, {
      tools: TOOLS,
      temperature: 0.7,
      max_tokens: 800,
    });' 'const r = await callGroq(apiKey, model, mensagens, {
      tools: TOOLS,
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 800,
    });'
