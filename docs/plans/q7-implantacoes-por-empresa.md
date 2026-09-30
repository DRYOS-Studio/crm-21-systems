# Q7 por empresa — implementação e atualizações

Plano aprovado em 30 de setembro de 2026. O estado abaixo distingue código local,
migrations aplicadas e funcionalidades promovidas para cada instalação.

## Estado de execução

- **Implementado no workspace:** limite de três follow-ups automáticos; exibição
  e persistência de NAVT/qualificação; campos personalizados e data de
  instalação com Agenda; troca de logo por admin; seleção de Gemini, OpenAI,
  Claude e Groq; segmentos dinâmicos usados na cadência; dashboard e eventos
  métricos; cotas-base aplicadas no banco; registro central de instalações,
  assinatura Asaas, sincronização de cobrança, bloqueio de envios e tela de
  faturamento.
- **Migrations:** CRM e banco local estão alinhados até `20260930180000`. No
  CRM, foram aplicadas `agent_ai_providers`, `organization_brand_logo`,
  `saved_prospect_segments`, `organization_quotas`, `conversation_metrics`,
  `billing_control_plane` e `control_plane_access`;
  o histórico remoto registra os mesmos IDs dos arquivos locais. A aplicação
  remota ocorreu sem backup, conforme autorização. O projeto atual foi marcado
  como plano de controle; instalações de clientes começam com o flag desligado.
  No banco local, as migrations foram aplicadas após backup e `db lint` passou
  sem erros.
- **Cotas no CRM:** há 2 membros e 2 canais registrados, com adicionais em zero.
  A cota-base comporta 5 membros e 1 canal; novas conexões ficam bloqueadas até
  a operação registrar eventual adicional contratado.
- **Promoção central:** as Edge Functions `asaas-webhook`,
  `process-asaas-events`, `billing-snapshot` e `manage-installation` foram
  publicadas no Supabase DRYOS. As funções `whatsapp-webhook`,
  `run-followups`, `run-outreach`, `manage-instance` e
  `test-ai-connection` também foram atualizadas para acompanhar o frontend.
  O cron central executa o processamento a cada minuto. Os secrets
  `ASAAS_API_KEY`, `ASAAS_ENVIRONMENT=sandbox` e `ASAAS_WEBHOOK_TOKEN` estão
  configurados sem registrar seus valores neste repositório. Os endpoints
  centrais responderam HTTP 401 a chamadas com credenciais inválidas.
- **Frontend de produção:** deployment Vercel
  `dpl_FmmK2zWwAp58XrRTxzyxEm9V6E3M` ficou `READY` e foi associado a
  `brain.dryos.com.br` e `crm-21.vercel.app`. O preview de validação permanece
  em `crm-21-rppcdvuc6-dryos-studio.vercel.app`.
- **Pendente nas instalações de clientes:** publicar `sync-billing-state`,
  frontend e demais funções em projetos dedicados. O webhook foi cadastrado no
  Asaas Sandbox e a confirmação de uma cobrança de teste atualizou o status da
  instalação para `active`. Cobrança em produção e atualização canário seguem
  pendentes.
- **Arquitetura definida:** o Supabase atual da DRYOS será o plano de controle,
  com webhook Asaas e registro das instalações. Cada empresa terá Supabase e
  Vercel próprios, fixados numa release, seguindo o modelo de stack dedicado do
  Aegis. Cada instalação consulta o plano de controle com um token aleatório
  próprio; o central guarda somente o hash e responde o estado mínimo de acesso.
  A sincronização falha fechada para novos envios após 10 minutos sem atualização.
- **Metas do piloto (premissas iniciais):** até 10 empresas no piloto e 100 em
  12 meses; sincronização a cada 5 minutos, propagação em até 10 minutos; pico
  de 50 consultas/minuto no controle central; teto incremental de R$ 300/mês
  para o plano de controle, excluindo tarifas Asaas e projetos de clientes.
  Rever os limites com métricas reais de uso e custos.
- **Contrato do webhook Asaas verificado:** considerar `PAYMENT_OVERDUE` para
  iniciar a tolerância e `PAYMENT_CONFIRMED` ou `PAYMENT_RECEIVED` para restaurar
  o acesso; deduplicar pelo `id` do evento e não depender da ordem de entrega.
  Reconciliar a cobrança pelo Asaas antes de mudar o estado para evitar que
  eventos antigos revertam uma cobrança mais recente. Validar o cabeçalho
  `asaas-access-token`, separado da chave da API. O receptor deve persistir o
  evento e responder rapidamente; processamento e reconciliação de estado ficam
  assíncronos.
- **Pendente de execução:** publicar o frontend e a função de sincronização nas
  instalações de clientes. Provisionamento dos projetos Supabase/Vercel, DNS e
  promoção de releases continuam manuais.
- **Validação pendente:** webhook e cobrança em produção, além da atualização
  canário. No Sandbox, o webhook central foi cadastrado, uma assinatura de teste
  foi criada e a confirmação simulada atualizou o status da instalação para
  `active`. O teste local de processamento Asaas cobre atraso, evento pago de
  fatura antiga fora de ordem e confirmação da fatura atual; os cinco testes
  unitários de cobrança e provedores de IA passaram. O teste isolado de bloqueio confirmou
  persistência do inbound sem chamada à IA ou resposta. A suíte ampla de
  webhook não passou porque 13 casos falharam ao criar usuários sintéticos no
  Auth local; o banco foi preservado, sem reset de dados. No remoto, foram
  conferidos o histórico até `20260930180000`, as tabelas, colunas e
  triggers criados pelas migrations. Em transações revertidas no banco local,
  passaram as cotas de usuários e canais e os eventos de qualificação, passagem
  ao humano, conversão e follow-up. Testes HTTP locais confirmaram autenticação,
  deduplicação e bloqueio após a tolerância.

## Resumo

Uma base de código, com Supabase e Vercel isolados por empresa. Cada cliente fica
fixado numa release; publicar em `main` não atualiza automaticamente suas
instalações. Cada fase segue **Specify → Design → Tasks → Implement → Validate**,
com revisão adversarial no Design e validação do diff antes da promoção.

## Fase 1 — completar funcionalidades parciais

- Limitar a três follow-ups automáticos por ciclo sem resposta, em dias
  distintos; manter os manuais separados.
- Mostrar NAVT e o estado de qualificação no painel da conversa, persistindo o
  resultado da IA.
- Preservar as tags coloridas. Criar campos personalizados em Configurações, no
  padrão funcional do Aegis, incluindo dados do veículo.
- Permitir que o atendente marque data e hora de instalação no lead e consulte
  os agendamentos numa Agenda. Reutilizar o controle de data/hora do follow-up.
  Origem fica para depois; estágios personalizados permanecem como estão.

## Fase 2 — Cloud e capacidades novas

- Permitir ao admin trocar a logo; dar a cada empresa um subdomínio e uma
  instalação isolada.
- Aplicar no servidor as cotas-base de cinco usuários e um canal WhatsApp. A
  operação habilita adicionais contratados; sem checkout de adicionais nesta
  versão.
- Cobrar R$ 397/mês via Asaas, com um receptor central de webhooks para todas
  as instalações. O acesso começa antes do primeiro pagamento. Após cinco dias
  completos de atraso, bloquear uso e envios, mas continuar recebendo e
  guardando mensagens; pagamento confirmado restaura o acesso. Manter acesso
  do admin a cobrança e suporte.
- Acrescentar Gemini, OpenAI e Claude sem retirar Groq nem alterar os
  controles NAVT.
- Criar segmentos dinâmicos salvos por tags e campos personalizados e usá-los
  na cadência de prospecção existente, respeitando opt-out, limites e
  prevenção de duplicidade.
- Criar dashboard interativo de conversas, qualificação, passagem ao humano,
  follow-ups e conversão; persistir antes os eventos necessários às métricas.

## Implantação e atualização por cliente

- Criar um setup por empresa para escolher as personalizações e os módulos
  entregues.
- Manter inventário operacional com subdomínio, projeto Supabase, projeto
  Vercel e versões verificadas de banco, funções e frontend de cada empresa.
  Provisionar sem criar forks do código.
- Criar releases imutáveis. Validar em staging; para cada cliente, conferir
  histórico de migrations, fazer backup, aplicar migrations pendentes,
  publicar Edge Functions e então promover o frontend da mesma release.
  Começar por um cliente canário e avançar gradualmente.
- Usar migrations progressivas e compatíveis com a versão anterior. Rollback
  de código não será tratado como rollback de banco; uma migration incompatível
  exige procedimento específico de recuperação.
- Antes da primeira atualização gerenciada, identificar instalações cujo SQL
  foi aplicado manualmente e regularizar seu histórico de migrations.
  Confirmar a versão realmente publicada e os fluxos críticos após cada
  promoção.

## Validação

Testar limites e bloqueios no backend, não apenas na interface; sequência e
interrupção de follow-ups; agendamentos; webhooks Asaas duplicados ou atrasados;
restabelecimento após pagamento; segmentação na prospecção; e atualização de um
cliente sem modificar os demais. Uma promoção só é concluída quando banco,
funções e frontend do cliente estiverem verificados na release-alvo.
