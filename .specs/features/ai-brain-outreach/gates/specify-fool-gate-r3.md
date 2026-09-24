# Fase 1 — fool-gate (spec) — rodada 3

**Veredito: FAIL** (2 BLOCKER, 7 WARN). Gate sem Bash (leitura). 3ª reprovação ⇒ limite de re-execuções atingido; escalado ao Rafael.
TLC **concorda** com os 2 BLOCKERs (não há divergência de mérito TLC × gate).

| # | Achado | Verificado pelo TLC | Resolução na r4 |
|---|---|---|---|
| B1 | Janela D5 por posição da outbound perde "pare" num interleaving (turno 1 grava outbound depois do "pare" inserido pelo turno 2). Original usa marcador por mensagem (`respondida = 0`) | leitura `02.dryos/codigo/src/db.js:114-117`; `whatsapp-webhook/index.ts:324,367,378` (envia e depois grava) | D5 reescrito: janela = inbound **não processadas** (marcador por mensagem); AC-A21 com o interleaving |
| B2 | D6 sem AC: rascunho grava optout do modelo como optout (`brain.ts:323`) | leitura `brain.ts:323` | AC-A5e (EXEC-LACUNA: baseline reprova) |

- W1 incorporado: AC-A20 — a releitura mira a escrita de **outro** turno; o turno que decide optout envia a despedida; releitura antes de **cada** bolha.
- W2 incorporado: monotonicidade de `descartar` só quando vem de optout; AC-A19 devolve stage.
- W3 incorporado: A5 +2 positivos com a frase dentro da mensagem; sonda sem âncora `^`, segue SATISFAZÍVEL.
- W4 incorporado: `owner_notify_phone` entra no escopo da AC-C3.
- W5 incorporado: AC-C3b (gravar `contact_phone` já canônico; unicidade sobre a chave) — mecanismo de migração dos existentes vai pro Design (Q1).
- W6 incorporado: Q-R1 cobre também conversa criada por `fromMe`.
- W7 feito: `battery/mut/M17-*` removido.
