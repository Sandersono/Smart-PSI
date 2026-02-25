# Implementation Plan: Smart PSI SaaS Public Go-Live Hardening

**Branch**: `001-saas-go-live` | **Date**: 2026-02-22 | **Spec**: `specs/001-saas-go-live/spec.md`  
**Input**: Feature specification from `/specs/001-saas-go-live/spec.md`

## Summary

Levar o Smart PSI para um go-live SaaS publico sem billing SaaS proprio no primeiro ciclo, eliminando bloqueadores de seguranca, privacidade por perfil, consistencia financeira e operacao em producao. A abordagem tecnica usa endurecimento do backend Express/Supabase, alinhamento de UX por role, reconciliacao financeira Asaas e stack operacional padrao em VPS Linux com Docker Compose e Caddy.

## Technical Context

**Language/Version**: TypeScript 5.8 (Node.js 22 runtime)  
**Primary Dependencies**: React 19, Vite 6, Express 4, Supabase JS 2, Vitest, Supertest, Playwright, Docker Compose, Caddy, Sentry  
**Storage**: Supabase Postgres (tables: patients, appointments, notes, financial_records, asaas_charges, clinic_members, integration settings)  
**Testing**: `npm run lint`, `npm test` (Vitest + Supertest), `npm run test:smoke` (Playwright), `npm run build`, `npm audit --omit=dev`  
**Target Platform**: Linux VPS com Docker Compose e reverse proxy TLS  
**Project Type**: Web application (SPA React + API Express no mesmo repositorio)  
**Performance Goals**: API p95 < 300ms para CRUD principais, erro de reconciliacao financeira igual a 0 em cenarios cobertos, uptime mensal >= 99.5% no go-live inicial  
**Constraints**: Equipe enxuta, sem billing SaaS de assinatura no go-live, LGPD orientado a minimo privilegio, integracoes Google/Asaas opcionais por feature flag  
**Scale/Scope**: Go-live inicial com clinicas piloto, foco em estabilidade de auth/RBAC/financeiro/operacao antes de expansao multi-clinica avancada

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

1. **Security and Privacy by Default**: PASS  
   Producao usa Bearer-only, bypass de dev condicionado por env, RBAC backend para dados clinicos e webhooks fechados por token.
2. **Backend as Source of Truth**: PASS  
   Regras de permissao, financeiro e integracoes ficam no `server.ts`; frontend apenas reflete autorizacoes.
3. **Test and Release Gates**: PASS  
   Gates definidos (`lint`, `test`, `build`, `audit`) e testes focados em auth/RBAC/financeiro.
4. **Lean Ops and Reproducible Deploys**: PASS  
   Estrutura Docker + Compose + Caddy + `/api/health` prevista e aplicavel em VPS.
5. **Observability and Controlled Change**: PASS  
   Logging estruturado com request id, Sentry opcional e controle de feature flags para rollout seguro.

## Project Structure

### Documentation (this feature)

```text
specs/001-saas-go-live/
|-- spec.md
|-- plan.md
`-- tasks.md
```

### Source Code (repository root)

```text
src/
|-- components/
|-- lib/
|-- services/
|-- App.tsx
`-- main.tsx

server.ts
supabase/
`-- migrations/

tests/
|-- backend/
`-- e2e/

ops/
|-- Caddyfile
`-- run-monthly-billing.sh

.github/
`-- workflows/

Dockerfile
docker-compose.yml
```

**Structure Decision**: Projeto web unico com frontend e backend no mesmo repositorio. Essa estrutura reduz overhead para equipe enxuta, facilita deploy em VPS e permite gates unificados de qualidade.

## Complexity Tracking

Sem violacoes da constituicao neste ciclo. Nao ha excecoes abertas.
