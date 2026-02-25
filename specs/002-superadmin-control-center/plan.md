# 002-superadmin-control-center - Plano de Execucao

## Objetivo
Criar um painel Superadmin no dominio `adminpsi.gccsoftware.com.br` para governanca SaaS multi-tenant, com controle de assinatura/bloqueio, feature flags, auditoria e base para proximos modulos (Asaas multi-tenant, Evolution/inbox e Kanban CRM).

## Modulos

### Modulo 1 - Fundacao da Plataforma (esta entrega)
- Banco: `platform_superadmins`, `tenant_subscriptions`, `tenant_feature_flags`, `platform_audit_logs`.
- Backend:
  - autenticacao de superadmin (`/api/superadmin/me`)
  - visao geral (`/api/superadmin/dashboard/overview`)
  - lista e busca de clinicas (`/api/superadmin/clinics`)
  - gestao de assinatura/status/plano e IDs Asaas por clinica
  - feature flags por clinica
  - auditoria de acoes
  - bloqueio de acesso por status de assinatura (past_due sem graca, suspended/cancelled)
- Frontend:
  - portal Superadmin (dominio dedicado)
  - gestao de clinica, assinatura, flags e auditoria
- Infra:
  - Caddy e Compose com `APP_URL` + `ADMIN_URL`
  - env vars para superadmin e dominios

### Modulo 2 - Asaas Multi-tenant (proximo)
- Assinatura recorrente por clinica no Asaas.
- Webhook de lifecycle (created, overdue, paid, cancelled) sincronizando `tenant_subscriptions`.
- Politicas de bloqueio automatico com periodo de graca configuravel.
- Tela de faturamento SaaS (receita, MRR, inadimplencia, cohort basica).

### Modulo 3 - Evolution + Inbox Omnichannel
- Conexao por clinica com Evolution API (instancia, token, webhooks).
- Caixa de mensagens estilo atendimento (threads, atribuicao, status, etiquetas/labels).
- Regras de roteamento por equipe e SLA de primeira resposta.

### Modulo 4 - CRM Kanban + Pipeline
- Pipelines customizaveis por clinica.
- Estagios customizaveis com drag-and-drop.
- Negocios/leads vinculados a contatos e conversas.
- Metricas de funil (entrada, conversao, ciclo medio).

### Modulo 5 - Automacoes por Labels
- Motor de regras: gatilho (label, mensagem, tempo em etapa), condicao e acao.
- Acoes iniciais: mover etapa, atribuir responsavel, criar tarefa, enviar template.
- Auditoria e simulacao de automacoes para evitar erro operacional.

## Regras de Produto
- Todo registro clinico continua vinculado ao paciente e ao `clinic_id`.
- Portal Superadmin separado por dominio e permissao.
- Interface em Portugues (pt-BR).
- Novas features entram por branch dedicada.

## Branches sugeridas
- `002-superadmin-control-center` (Modulo 1)
- `003-asaas-tenant-subscriptions`
- `004-evolution-inbox-core`
- `005-crm-kanban-pipeline`
- `006-automation-label-rules`
