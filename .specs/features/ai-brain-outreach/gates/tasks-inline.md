# Fase 3 — gate inline (auto-revisão do TLC), 2026-09-24

- Atomicidade: 38 tasks, cada uma 1 arquivo ou 2-3 coisas coesas no mesmo arquivo (migration por bloco).
- Critério: 38/38 com "Done when" + "Verify"; toda task de código nomeia a mutação que o teste tem de reprovar.
- Dependências: 3 erradas no plano v1 (T24 atrelado a T19-21; T14 atrelado a T17; T7 atrás de T6) — corrigidas.
- Cobertura: script sobre spec × tasks — os 71 ACs referenciados; faltavam os EXEC-MATA (A1…A11) e AC-A0, tornados explícitos (T11; cabeçalho).
- Veredito: PASS.
