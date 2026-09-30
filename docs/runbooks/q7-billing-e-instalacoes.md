# Cobrança e instalações Q7

## Arquitetura

O Supabase DRYOS hospeda o plano de controle: inventário das empresas, integração
com Asaas e distribuição do estado de cobrança. Cada cliente usa seu próprio
Supabase e projeto Vercel. O token de sincronização é único por instalação; o
plano de controle armazena somente seu hash. Nenhuma service-role key de cliente
fica no controle central.

Metas iniciais: até 10 empresas no piloto, 100 em 12 meses, sincronização a cada
5 minutos, propagação em até 10 minutos, pico de 50 consultas por minuto e teto
incremental de R$ 300/mês para o controle central. As mensalidades Asaas e os
projetos dedicados dos clientes não entram nesse teto.

## Configurar o controle central

No ambiente atual, os secrets do Asaas já estão configurados no Supabase DRYOS,
e as funções centrais `asaas-webhook`, `process-asaas-events`,
`billing-snapshot` e `manage-installation` estão publicadas. O cron de
processamento está ativo a cada minuto. Ainda falta cadastrar o webhook na conta
Sandbox e validar a entrega de eventos.

1. Configure `ASAAS_API_KEY` como secret de Edge Functions no Supabase DRYOS.
   Use a chave sandbox durante a homologação.
2. Gere um token aleatório com pelo menos 32 caracteres e configure-o como
   `ASAAS_WEBHOOK_TOKEN` no mesmo projeto. Não reutilize a chave da API Asaas.
3. Configure `ASAAS_ENVIRONMENT=sandbox` durante os testes. Remova ou defina
   como `production` antes de usar a conta real.
4. Publique `asaas-webhook`, `process-asaas-events`, `billing-snapshot` e
   `manage-installation` somente no projeto central.
5. Execute `supabase/setup/billing-control-plane-cron.sql` no projeto central,
   substituindo `<PROJECT_REF>` e `<ANON_KEY>`. Isso marca o projeto como plano
   de controle e agenda o processamento da fila Asaas.
6. Em **Configurações > Instalações**, use **Configurar webhook central**.
   O e-mail recebe alertas do Asaas. Se o endpoint já existir, confirme no
   painel Asaas que o token configurado corresponde a `ASAAS_WEBHOOK_TOKEN`.

## Registrar e cobrar uma empresa

1. Em **Configurações > Instalações**, registre a empresa e um slug único.
2. Guarde o token de sincronização exibido. Ele só pode ser consultado uma vez;
   use **Renovar token** se precisar substituí-lo.
3. Cadastre subdomínio, referências dos projetos Supabase e Vercel e as versões
   verificadas no inventário.
4. Abra **Criar assinatura de R$ 397/mês**, informe o pagador, vencimento inicial
   e forma de pagamento. O endpoint procura primeiro um cliente ou assinatura
   com o mesmo `externalReference`, evitando duplicatas em novas tentativas.
5. Confirme a assinatura e o link de cobrança no painel do Asaas. A criação da
   assinatura não significa que a primeira cobrança foi paga.

## Preparar o Supabase de cada cliente

1. Aplique migrations pendentes antes de publicar funções ou frontend.
2. Configure os secrets `Q7_CONTROL_PLANE_URL`, `Q7_CONTROL_PLANE_ANON_KEY`,
   `Q7_INSTALLATION_ID` e `Q7_INSTALLATION_TOKEN` no projeto do cliente.
   Use o ID e token da instalação registrados no controle central.
3. Publique `sync-billing-state` nesse projeto.
4. Execute `supabase/setup/billing-cron.sql` no projeto do cliente, substituindo
   `<PROJECT_REF>` e `<ANON_KEY>`.
5. Verifique em `public.q7_local_access` que `synchronized_at` se atualiza e que
   `billing_status` acompanha o controle central.
6. Registre no inventário a release de banco, funções e frontend depois de
   conferir a instalação.

O acesso começa liberado. Após o vencimento, o cliente permanece liberado até
completar cinco dias inteiros de atraso. O sistema então bloqueia a interface e
todos os envios; o webhook de WhatsApp continua gravando mensagens recebidas.
Um pagamento `CONFIRMED` ou `RECEIVED` libera o acesso novamente. Eventos são
deduplicados pelo identificador Asaas e reconciliados pela API antes de mudar o
estado, para que uma entrega atrasada não reverta um ciclo mais recente.

Se a instalação não sincronizar por mais de 10 minutos, novos envios são
bloqueados até a próxima sincronização bem-sucedida. Administradores mantêm
acesso ao CRM para suporte; qualquer usuário bloqueado pode abrir a página de
Faturamento para consultar o status e a cobrança disponível.

## Limites desta versão

- A criação de projetos Supabase e Vercel e a configuração de DNS continuam
  sendo operações manuais.
- A promoção de releases por cliente continua sendo manual e não ocorre ao
  publicar em `main`.
- O fluxo ainda depende da configuração dos secrets Asaas e dos secrets de cada
  instalação antes da primeira cobrança real.
