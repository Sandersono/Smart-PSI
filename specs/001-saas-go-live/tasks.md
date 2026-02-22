---

description: "Task list for Smart PSI SaaS public go-live hardening"

---

# Tasks: Smart PSI SaaS Public Go-Live Hardening

**Input**: Design documents from `/specs/001-saas-go-live/`  
**Prerequisites**: plan.md (required), spec.md (required for user stories)  
**Tests**: Testes automatizados sao obrigatorios para fluxos criticos (auth, RBAC, financeiro, webhooks, deploy gate).  
**Organization**: Tasks agrupadas por user story para implementacao e validacao independente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependencia direta)
- **[Story]**: Mapeamento para US1, US2, US3, US4
- Descricoes incluem caminhos de arquivo exatos

## Path Conventions

- Projeto web unico: `server.ts`, `src/`, `tests/`, `ops/`, `supabase/`, `.github/`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Preparar baseline operacional e de configuracao para o ciclo SaaS.

- [ ] T001 [P] [Shared] Revisar e padronizar variaveis de ambiente em `.env.example` e `.env.production.example` (`ALLOW_DEV_USER_BYPASS`, `CORS_ALLOWED_ORIGINS`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, `FEATURE_GOOGLE_ENABLED`, `FEATURE_ASAAS_ENABLED`)
- [ ] T002 [Shared] Atualizar documentacao de setup e go-live em `README.md` (envs obrigatorias, deploy VPS, rollback)
- [ ] T003 [P] [Shared] Validar padrao de health endpoint em `server.ts` e uso de healthcheck em `docker-compose.yml`
- [ ] T004 [P] [Shared] Garantir que compose e runtime ignoram arquivos sensiveis via `.dockerignore` e `.gitignore`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Fundacao de seguranca, observabilidade e controle de acesso.

**CRITICAL**: Nenhuma story deve seguir sem esta fase completa.

- [ ] T005 [US1] Endurecer resolucao de contexto em `server.ts` para aceitar `x-user-id` apenas fora de producao com `ALLOW_DEV_USER_BYPASS=true`
- [ ] T006 [P] [US1] Aplicar middleware de seguranca global em `server.ts` (`helmet`, `cors` allow-list, `compression`, rate limiting)
- [ ] T007 [P] [US1] Implementar logging estruturado com `request_id` por requisicao em `server.ts`
- [ ] T008 [US1] Fechar webhooks por configuracao/token em `server.ts` (`/api/integrations/google/webhook`, `/api/asaas/webhook`)
- [ ] T009 [P] [US1] Sanitizar callback OAuth Google em `server.ts` para evitar interpolacao HTML insegura
- [ ] T010 [US1] Criar/expandir cobertura de teste de fundacao em `tests/backend/security-hardening.test.ts`

**Checkpoint**: Foundation pronta para evolucao por historias.

---

## Phase 3: User Story 1 - Seguranca e Privacidade por Perfil (Priority: P1)

**Goal**: Garantir auth obrigatoria e isolamento clinico por papel, com backend como fonte de verdade.

**Independent Test**: Requisicoes sem Bearer retornam `401`; secretaria nao visualiza/edita clinico; webhooks sem token retornam `503`.

### Tests for User Story 1

- [x] T011 [P] [US1] Adicionar cenarios de auth obrigatoria em `tests/backend/security-hardening.test.ts`
- [x] T012 [P] [US1] Adicionar cenarios de RBAC `secretary` (leitura/escrita clinica) em `tests/backend/security-hardening.test.ts`

### Implementation for User Story 1

- [ ] T013 [US1] Reforcar redacao de dados de pacientes por role em `server.ts` (`GET /api/patients`, `GET /api/patients/:id/history`)
- [ ] T014 [US1] Bloquear alteracao de `notes` clinico por `secretary` em `server.ts` (`PUT /api/patients/:id`)
- [ ] T015 [P] [US1] Condicionar exibicao clinica no frontend em `src/components/Patients.tsx`
- [ ] T016 [P] [US1] Condicionar tab/edicao clinica por role em `src/components/PatientProfile.tsx`
- [ ] T017 [US1] Alinhar menus e acoes por papel em `src/components/Sidebar.tsx`, `src/components/Settings.tsx`, `src/components/Financial.tsx`
- [ ] T018 [US1] Validar resposta consistente de erro `401/403` no client API em `src/lib/api.ts`

**Checkpoint**: Privacidade por perfil validada de ponta a ponta.

---

## Phase 4: User Story 2 - Consistencia Financeira com Asaas (Priority: P1)

**Goal**: Eliminar divergencia entre cobrancas Asaas, financeiro interno e resumo mensal.

**Independent Test**: Estados Asaas refletem no financeiro e no resumo sem divergencia.

### Tests for User Story 2

- [ ] T019 [P] [US2] Cobrir reconciliacao Asaas (`PENDING`, `OVERDUE`, `RECEIVED`, `REFUNDED`) em `tests/backend/security-hardening.test.ts`
- [ ] T020 [P] [US2] Cobrir cancelamento/exclusao de agendamento com cobranca vinculada em `tests/backend/security-hardening.test.ts`

### Implementation for User Story 2

- [ ] T021 [US2] Ajustar geracao de cobranca para priorizar `patients.session_fee` em `server.ts`
- [ ] T022 [US2] Aplicar fallback de valor de sessao somente quando necessario em `server.ts`
- [ ] T023 [US2] Unificar reconciliacao de webhook Asaas para manter `financial_records` consistente em `server.ts`
- [ ] T024 [US2] Ajustar fluxo de cancelamento/exclusao de agendamento e cobranca em `server.ts`
- [ ] T025 [US2] Revisar resumo mensal e agregacoes financeiras em `server.ts`
- [ ] T026 [US2] Validar tipos de dados financeiros compartilhados em `src/lib/types.ts` e consumo em `src/components/Financial.tsx`

**Checkpoint**: Financeiro consistente em todos os estados obrigatorios.

---

## Phase 5: User Story 3 - Operacao SaaS Reproduzivel em Equipe Enxuta (Priority: P2)

**Goal**: Permitir deploy/rollback rapido e operacao com observabilidade minima.

**Independent Test**: Stack sobe em VPS com HTTPS, healthcheck, CI/CD e alerta de erros.

### Tests for User Story 3

- [ ] T027 [P] [US3] Validar healthcheck e readiness em ambiente local Docker com `docker compose up -d`
- [ ] T028 [P] [US3] Validar pipeline de CI (`lint`, `test`, `build`) em `.github/workflows/ci-cd.yml`

### Implementation for User Story 3

- [ ] T029 [US3] Finalizar imagem multi-stage em `Dockerfile` para frontend build + runtime Node
- [ ] T030 [US3] Finalizar stack de deploy em `docker-compose.yml` (app + caddy + restart policy + healthcheck)
- [ ] T031 [US3] Revisar configuracao TLS/reverse proxy em `ops/Caddyfile`
- [ ] T032 [US3] Validar script de job mensal autenticado em `ops/run-monthly-billing.sh`
- [ ] T033 [US3] Garantir capturas de erro em runtime backend em `server.ts` (Sentry opcional por env)
- [ ] T034 [US3] Garantir captura de erro frontend em `src/main.tsx` (Sentry opcional por env)

**Checkpoint**: Operacao SaaS minima pronta para staging/canario.

---

## Phase 6: User Story 4 - Completude de UX por Perfil e Recuperacao de Senha (Priority: P3)

**Goal**: Reduzir atrito de suporte e alinhar experiencia com regras de permissao.

**Independent Test**: Fluxo de reset funciona; secretaria nao ve controles indevidos; datas nao sofrem drift.

### Tests for User Story 4

- [ ] T035 [P] [US4] Expandir smoke e2e para login/signup/forgot/reset em `tests/e2e/smoke.spec.ts`
- [ ] T036 [P] [US4] Cobrir restricoes de UI por role em `tests/e2e/smoke.spec.ts`

### Implementation for User Story 4

- [ ] T037 [US4] Consolidar fluxo de recuperacao/redefinicao no frontend em `src/components/Auth.tsx`
- [ ] T038 [US4] Aplicar utilitarios de data local em `src/lib/date.ts` e substituir usos em `src/components/Agenda.tsx` e `src/components/Financial.tsx`
- [ ] T039 [US4] Finalizar tipagem explicita em `src/lib/types.ts`, `src/components/Agenda.tsx`, `src/components/Financial.tsx`, `src/components/Settings.tsx`, `src/components/PatientProfile.tsx`
- [ ] T040 [US4] Ajustar branding/metadados e idioma em `index.html` e `metadata.json`

**Checkpoint**: UX consistente com backend e sem regressao de datas.

---

## Phase 7: Polish and Go-Live Gate

**Purpose**: Fechar o ciclo com validacao final e checklist de release.

- [x] T041 [Shared] Rodar `npm run lint`
- [x] T042 [Shared] Rodar `npm test`
- [x] T043 [Shared] Rodar `npm run build`
- [x] T044 [Shared] Rodar `npm audit --omit=dev`
- [x] T045 [Shared] Rodar `.\.specify\scripts\powershell\update-agent-context.ps1 -AgentType codex`
- [x] T046 [Shared] Rodar `.\.specify\scripts\powershell\check-prerequisites.ps1 -Json -RequireTasks -IncludeTasks`
- [ ] T047 [Shared] Validar compose em staging com `docker compose up -d` e smoke rapido
- [ ] T048 [Shared] Executar checklist LGPD operacional (logs sem dados sensiveis, RBAC validado, trilha de incidentes)
- [ ] T049 [Shared] Executar canario com clinicas piloto por 7 dias sem incidentes criticos
- [ ] T050 [Shared] Liberar go-live publico apos gate verde

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup (Phase 1): inicia imediatamente.
- Foundational (Phase 2): depende de Setup e bloqueia todas as historias.
- User Stories (Phase 3-6): dependem da fundacao pronta.
- Polish (Phase 7): depende das historias obrigatorias completas.

### User Story Dependencies

- US1 (P1): inicia apos Foundational.
- US2 (P1): inicia apos Foundational; pode rodar em paralelo com US1.
- US3 (P2): pode iniciar com US1/US2, mas go-live depende dos entregaveis minimos de operacao.
- US4 (P3): pode iniciar apos Foundational e fechar junto do polish.

### Parallel Opportunities

- T006, T007, T009 podem rodar em paralelo na fundacao.
- T011 e T012 podem rodar em paralelo (mesmo arquivo, blocos independentes com coordenacao).
- T019 e T020 podem rodar em paralelo (cenarios financeiros independentes).
- T029, T030, T031 podem rodar em paralelo (arquivos distintos de deploy).
- T035 e T036 podem rodar em paralelo (smokes distintos).

## Implementation Strategy

### MVP First (Security + Financial Core)

1. Completar Phase 1 e Phase 2.
2. Completar US1 e validar testes de auth/RBAC/webhooks.
3. Completar US2 e validar reconciliacao financeira.
4. Congelar novas features e seguir para operacao.

### Incremental Delivery

1. Foundation pronta.
2. US1 validada e demonstravel.
3. US2 validada e demonstravel.
4. US3 validada em staging.
5. US4 + polish + gate final.

## Notes

- Tarefas [P] devem evitar conflito no mesmo arquivo.
- Sempre validar backend antes de liberar ajustes de UI por role.
- Nao publicar sem gate de release completo.
