# Especificação — usuários e permissões

**Status:** Approved — 2026-09-30; CRM/Conversas serão concedidos em conjunto.
**Escopo:** uma organização por instalação Supabase, conforme o modelo atual.

## Problema

Administradores não têm uma tela para convidar e gerenciar usuários ou limitar
seu acesso. Hoje os membros compartilham dados da organização, e as permissões
individuais por módulo e instância WhatsApp não existem.

## Premissas deste rascunho

- “Dispositivos” são as instâncias/conexões WhatsApp (`whatsapp_instances`).
- O MVP controla acesso por módulo e por instância com permissões ligadas ou
  desligadas. Um acesso concedido libera as operações normais daquele escopo.
- O CRUD oferece convite, edição de acessos, ativação e desativação. A
  desativação preserva os dados e o histórico; exclusão permanente fica fora.
- Admins mantêm acesso total e continuam sendo geridos apenas por outro admin.
- A disponibilidade de módulos por empresa será um limite separado, a ser
  implementado no setup de empresa planejado. Neste MVP, todos os módulos do
  produto estão disponíveis para concessão individual.
- Módulos: Dashboard, Conversas, CRM, Agenda, Prospecção e Configurações.
  Acesso às configurações administrativas continua restrito a admin.
- CRM e Conversas são concedidos como um único conjunto no MVP, pois compartilham
  `conversations`; o admin não pode habilitar um sem o outro.
- Agenda e Dashboard exigem o conjunto CRM + Conversas, pois consultam
  `conversations`/`conversation_events`.
- Dados sem instância WhatsApp vinculada continuam seguindo o escopo atual da
  organização quando o usuário tem acesso ao módulo correspondente.

## Objetivos

- Permitir ao admin consultar membros e convidar novos usuários.
- Permitir ao admin conceder e revogar módulos e instâncias WhatsApp por usuário.
- Permitir ao admin desativar e reativar usuários sem apagar seu histórico.
- Impor as permissões no frontend, no RLS e nas Edge Functions que usam
  `service_role`.
- Preservar o acesso atual dos membros existentes na migração inicial; novos
  convites começam sem permissões até o admin concedê-las.
- Permitir que a pessoa convidada defina sua senha pelo link de convite antes
  de usar o login existente.

## Histórias e critérios de aceite

### P1 — Administrar membros

Como admin, quero convidar, consultar, editar acessos e desativar membros da
minha organização.

1. Quando um admin envia um convite válido, o sistema cria/convoca uma conta
   `user`, associa-a à organização atual e não concede papel de admin.
2. Quando um não-admin tenta administrar membros, o servidor recusa a operação,
   mesmo que a requisição seja feita diretamente à Edge Function.
3. Quando o admin desativa um membro, o membro deixa de acessar o produto e os
   dados associados permanecem preservados.
4. Um admin não pode desativar a própria conta nem remover o último admin ativo.

### P1 — Controlar acesso a módulos

Como admin, quero ativar ou desativar módulos para cada membro.

1. Um módulo sem concessão não aparece na navegação e sua rota direta é negada.
2. Acesso aos dados e operações do módulo também é negado no banco/servidor;
   esconder o menu não é controle de autorização suficiente.
3. Admins mantêm acesso total, independentemente das concessões de membro.
4. Sem Conversas, Agenda também fica indisponível; com Conversas e sem Agenda,
   o usuário mantém conversas e não acessa a rota da Agenda.
5. CRM e Conversas são sempre concedidos/revogados juntos.

### P1 — Controlar acesso a instâncias WhatsApp

Como admin, quero escolher quais instâncias cada membro pode acessar.

1. Um membro vê e usa somente instâncias concedidas a ele.
2. Conversas e mensagens ligadas a uma instância seguem a mesma concessão,
   inclusive em consultas diretas, mídia anexada e funções de servidor.
3. Um membro sem acesso ao módulo Conversas não acessa conversas mesmo que tenha
   concessão à instância.
4. Dados sem instância seguem a premissa de escopo organizacional descrita acima.
5. Arquivos de conversa só são baixados após checagem do módulo e da instância;
   conhecer ou reutilizar uma URL não concede acesso.

## Fora do escopo

- Matriz de ações separadas de leitura, criação, edição e exclusão por módulo.
- Configuração de módulos entregues por empresa.
- Exclusão permanente de contas e transferência automática de propriedade de
  dados.
- Convites em lote e trilha de auditoria administrativa.
- Permissão de Agenda independente de Conversas.
- Permissões independentes para CRM e Conversas no MVP.

## Riscos e validação

- A autorização atual mistura políticas organizacionais e políticas por dono.
  A migração precisa atualizar todas as tabelas/Edge Functions relevantes sem
  cortar dados compartilhados existentes.
- A migração deve preservar o acesso dos usuários atuais e negar por padrão
  concessões ausentes para convites novos.
- Testar com dois membros: negar rota e consulta direta sem permissão; conceder
  módulo/instância e confirmar acesso somente ao escopo concedido; confirmar que
  admin mantém acesso total e membro desativado perde acesso.
