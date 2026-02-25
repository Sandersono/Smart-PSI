# 003-asaas-tenant-subscriptions - Plano

## Objetivo
Adicionar sincronizacao de assinatura SaaS por clinica com Asaas, incluindo reconciliacao por webhook e sincronizacao manual pelo portal superadmin.

## Escopo desta entrega
- Reconciliar `tenant_subscriptions` via `/api/asaas/webhook` quando payload trouxer dados de assinatura.
- Preservar fluxo existente de cobrancas de paciente no mesmo webhook.
- Adicionar endpoint superadmin para sincronizar assinatura diretamente na API Asaas.
- Adicionar acao no frontend superadmin para acionar sincronizacao manual.
- Cobrir com testes de seguranca/regressao.

## Fora de escopo desta entrega
- Criacao automatica da assinatura SaaS no Asaas.
- Motor completo de faturamento (MRR, dashboards financeiros SaaS).
- Gestao de retries, filas e dead-letter para webhooks.
