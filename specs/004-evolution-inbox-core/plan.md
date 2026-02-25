# 004-evolution-inbox-core - Plano

## Objetivo
Entregar o modulo base de mensageria por clinica com Evolution API e caixa de atendimento (inbox), mantendo segregacao multi-tenant e operacao em pt-BR.

## Escopo desta entrega
- Criar schema base para conexao Evolution, threads de atendimento e mensagens.
- Adicionar APIs para:
  - configuracao/status/desconexao da integracao Evolution por clinica;
  - ingestao de webhook Evolution para criar/atualizar threads e mensagens;
  - operacao de inbox (listar threads, listar mensagens, atualizar status/atribuicao/labels, marcar como lido e enviar mensagem).
- Criar interface de atendimento no frontend com:
  - lista de conversas;
  - leitura/envio de mensagens;
  - status do atendimento;
  - atribuicao de responsavel;
  - etiquetas (labels).
- Cobrir fluxo principal com testes backend.

## Fora de escopo desta entrega
- Motor de automacao por labels.
- SLA de primeira resposta e relatorios de atendimento.
- Campanhas, chatbot, templates e disparo em massa.
- Kanban de funil comercial (modulo 005).
