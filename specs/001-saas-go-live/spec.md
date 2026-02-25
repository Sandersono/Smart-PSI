# Feature Specification: Smart PSI SaaS Public Go-Live Hardening

**Feature Branch**: `001-saas-go-live`  
**Created**: 2026-02-22  
**Status**: Draft  
**Input**: User description: "Levar o Smart PSI para go-live SaaS publico sem billing proprio no primeiro ciclo, com foco em seguranca, privacidade por perfil, consistencia financeira e operacao em VPS com Docker."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Seguranca e Privacidade por Perfil (Priority: P1)

Como dono da clinica, quero que autenticacao e permissoes sejam aplicadas no backend para impedir acesso indevido a dados clinicos e operacoes sensiveis.

**Why this priority**: Sem esse bloco, o sistema nao pode ser exposto como SaaS publico.

**Independent Test**: Pode ser validado com testes de API para auth obrigatoria, RBAC de secretaria e bloqueio de webhooks sem token.

**Acceptance Scenarios**:

1. **Given** ambiente de producao, **When** uma requisicao protegida chega sem `Authorization: Bearer`, **Then** a API retorna `401`.
2. **Given** usuario com papel `secretary`, **When** consulta pacientes e historico, **Then** dados clinicos (`notes`) nao sao retornados.
3. **Given** usuario `secretary`, **When** tenta editar `notes` clinico de paciente, **Then** a API retorna `403`.
4. **Given** token de webhook nao configurado, **When** endpoint de webhook recebe trafego, **Then** a API retorna `503` com erro explicito.

---

### User Story 2 - Consistencia Financeira com Asaas (Priority: P1)

Como profissional da clinica, quero que cobrancas e resumo mensal fiquem sempre consistentes entre agenda, Asaas e financeiro interno.

**Why this priority**: Divergencia financeira compromete confianca do produto e inviabiliza operacao SaaS.

**Independent Test**: Pode ser validado com cenarios de criacao/cancelamento de cobranca e webhooks Asaas (`PENDING`, `OVERDUE`, `RECEIVED`, `REFUNDED`).

**Acceptance Scenarios**:

1. **Given** sessao vinculada a paciente com `session_fee`, **When** gera cobranca, **Then** o valor usa `patients.session_fee` (fallback controlado apenas quando vazio).
2. **Given** webhook Asaas de pagamento/estorno/cancelamento, **When** evento e processado, **Then** `asaas_charges`, `financial_records` e resumo mensal refletem o mesmo estado.
3. **Given** agendamento com cobranca vinculada, **When** agendamento e cancelado/excluido, **Then** a cobranca vinculada e reconciliada e o financeiro interno e atualizado.

---

### User Story 3 - Operacao SaaS Reproduzivel em Equipe Enxuta (Priority: P2)

Como equipe enxuta, queremos deploy padrao e observabilidade minima para operar com baixo esforco.

**Why this priority**: Reduz risco operacional no go-live e acelera resposta a incidentes.

**Independent Test**: Pode ser validado subindo stack Docker em VPS, checando healthcheck, TLS, CI/CD e logs com request id.

**Acceptance Scenarios**:

1. **Given** ambiente novo de VPS Linux, **When** executa `docker compose up -d`, **Then** aplicacao sobe com HTTPS ativo via reverse proxy e `/api/health` responde com `ok`.
2. **Given** pipeline CI/CD, **When** lint/test/build falha, **Then** deploy nao e promovido.
3. **Given** erro em runtime, **When** ocorre excecao backend/frontend, **Then** evento e observavel por logging estruturado e monitoramento de erro configurado.

---

### User Story 4 - Completude de UX por Perfil e Recuperacao de Senha (Priority: P3)

Como usuario final, quero fluxo de recuperacao de senha e interface coerente com meu perfil para reduzir suporte manual.

**Why this priority**: Melhora usabilidade e reduz risco de acesso acidental a funcoes indevidas.

**Independent Test**: Pode ser validado por smoke test frontend cobrindo login/signup, forgot password e restricoes de UI por role.

**Acceptance Scenarios**:

1. **Given** usuario sem acesso a conta, **When** solicita recuperacao de senha, **Then** recebe fluxo de reset por email e consegue definir nova senha.
2. **Given** usuario `secretary`, **When** navega em financeiro/configuracoes/perfil paciente, **Then** nao visualiza acoes administrativas ou clinicas bloqueadas por papel.
3. **Given** entradas de data em timezone local, **When** salva e reabre dados, **Then** nao ocorre deslocamento de dia por conversao UTC indevida.

---

### Edge Cases

- Token de acesso expirado durante operacao sensivel deve resultar em erro controlado (`401`) e reautenticacao na UI.
- Webhook Asaas ou Google recebido em duplicidade deve ser processado de forma idempotente.
- Integracao Google/Asaas desabilitada por feature flag deve responder estado explicito sem quebrar fluxos principais.
- Cancelamento de sessao com cobranca ja recebida deve preservar trilha financeira e impedir perda de historico.
- Execucao repetida de job mensal no mesmo periodo nao deve duplicar lancamentos.
- Campos de data no horario de verao ou meia-noite local nao podem virar dia no salvamento.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Sistema MUST aceitar bypass de usuario por header `x-user-id` apenas fora de producao e somente com `ALLOW_DEV_USER_BYPASS=true`.
- **FR-002**: Sistema MUST exigir token `Bearer` valido para contexto de usuario em producao.
- **FR-003**: Sistema MUST aplicar `helmet`, `cors`, `compression` e `rate limit` configuraveis por variaveis de ambiente.
- **FR-004**: Sistema MUST aplicar RBAC backend para ocultar e bloquear escrita de dados clinicos para papel `secretary`.
- **FR-005**: Sistema MUST rejeitar webhooks sem token configurado com `503`.
- **FR-006**: Sistema MUST rejeitar webhooks com token invalido com `401`.
- **FR-007**: Sistema MUST usar `patients.session_fee` como valor principal na cobranca por sessao.
- **FR-008**: Sistema MUST aplicar fallback de valor de sessao somente quando `patients.session_fee` estiver vazio ou invalido.
- **FR-009**: Sistema MUST reconciliar eventos Asaas em `asaas_charges` e `financial_records`.
- **FR-010**: Sistema MUST manter resumo mensal consistente com os status reconciliados.
- **FR-011**: Sistema MUST tratar cancelamento/exclusao de agendamento com cobranca vinculada sem deixar estado orfao.
- **FR-012**: Sistema MUST oferecer fluxo de recuperacao e redefinicao de senha no frontend com Supabase Auth.
- **FR-013**: Sistema MUST condicionar UI por papel e nunca expor acao que backend bloqueia para o mesmo papel.
- **FR-014**: Sistema MUST padronizar manipulacao de datas locais para evitar drift de timezone em formularios.
- **FR-015**: Sistema MUST ter stack de deploy reproduzivel com `Dockerfile`, `docker-compose` e reverse proxy TLS.
- **FR-016**: Sistema MUST publicar endpoint de healthcheck para readiness/liveness.
- **FR-017**: Sistema MUST registrar logs estruturados com `request_id` por requisicao.
- **FR-018**: Sistema MUST permitir habilitar/desabilitar Google e Asaas por `FEATURE_GOOGLE_ENABLED` e `FEATURE_ASAAS_ENABLED`.
- **FR-019**: Sistema MUST manter segredos de producao fora do repositario e documentar rotacao.
- **FR-020**: Sistema MUST bloquear release quando gates minimos (`lint`, `test`, `build`, `audit`) falharem.

### Key Entities *(include if feature involves data)*

- **AuthContext**: Contexto derivado de token com `userId`, `clinicId` e `role`, usado para validar autorizacao em todas as rotas.
- **ClinicMember**: Vinculo usuario-clinica com papel (`admin`, `professional`, `secretary`) e status ativo.
- **Patient**: Cadastro de paciente com dados de contato, `session_fee`, `billing_mode_override` e `notes` clinicas com acesso restrito.
- **Appointment**: Sessao agendada com profissional, paciente, horario, recorrencia e relacao opcional com eventos Google/Asaas.
- **AsaasCharge**: Registro interno de cobranca externa (`asaas_charge_id`, `status`, `amount`, `due_date`) ligado a paciente e sessao.
- **FinancialRecord**: Lancamento financeiro canonico usado em relatorios e resumo mensal, reconciliado com eventos Asaas.
- **IntegrationSettings**: Configuracoes por clinica para Google e Asaas, incluindo feature flags e segredos operacionais.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% dos cenarios de autenticacao obrigatoria e RBAC criticos passam em testes automatizados backend.
- **SC-002**: Em matriz de testes Asaas (pagamento, atraso, cancelamento, estorno), divergencia entre `asaas_charges`, `financial_records` e resumo mensal e igual a zero.
- **SC-003**: Deploy completo em VPS (build + compose + TLS + healthcheck) e reproduzivel em ate 1 comando operacional.
- **SC-004**: Suite de smoke frontend cobre fluxos de login, agenda, financeiro e restricoes por papel sem falhas criticas.
- **SC-005**: Go-live canario de 7 dias sem incidentes criticos de seguranca, privacidade por perfil ou consistencia financeira.
