# SmartPSI

Aplicacao full-stack (React + Express) para operacao de clinica: pacientes, agenda, notas clinicas, financeiro, Asaas e Google Agenda.

## Stack

- Frontend: React 19 + Vite + Tailwind
- Backend: Express + TypeScript
- Banco: Supabase (Postgres + Auth)
- Deploy recomendado: VPS Linux + Docker Compose + Caddy (TLS automatico)

## Setup local

1. Instale dependencias:
   - `npm install`
2. Configure variaveis de ambiente:
   - copie `.env.example` para `.env.local` (ou `.env`) e preencha os valores.
3. Execute as migracoes no Supabase SQL Editor, nesta ordem:
   - `supabase/migrations/20260221_001_init.sql`
   - `supabase/migrations/20260221_002_clinic_rbac_agenda_asaas.sql`
   - `supabase/migrations/20260221_003_google_agenda_notes_source.sql`
   - `supabase/migrations/20260221_004_financial_monthly_asaas_settings.sql`
   - `supabase/migrations/20260222_005_ai_usage_meter.sql`
   - `supabase/migrations/20260224_006_patient_linkage_guardrails.sql`
   - `supabase/migrations/20260225_007_superadmin_platform_foundation.sql`
   - `supabase/migrations/20260225_008_evolution_inbox_core.sql`
4. Rode a aplicacao:
   - `npm run dev`

## Hardening aplicado

- Bypass por `x-user-id` habilitado apenas fora de producao e com `ALLOW_DEV_USER_BYPASS=true`.
- Em producao, autenticacao exige `Authorization: Bearer`.
- `helmet`, `cors` por allow-list, `compression` e rate limit por ambiente.
- Webhooks Google/Asaas retornam `503` quando token nao configurado.
- Webhook Evolution valida token por clinica (`webhook_secret`) com fallback em `EVOLUTION_WEBHOOK_TOKEN`.
- RBAC clinico: secretaria sem leitura/escrita de conteudo clinico de pacientes.
- Dependencias com overrides para mitigar vulnerabilidades transitivas (`minimatch`/`glob`).

## Medidor de IA

- Endpoint de transcricao (`/api/ai/process-audio`) registra consumo estimado em `ai_usage_events`.
- Resumo mensal por clinica: `GET /api/ai/usage/summary?month=YYYY-MM`.
- Parametros de estimativa e custo por env:
  - `AI_MODEL_NAME`
  - `AI_TOKEN_COST_PER_MILLION`
  - `AI_AUDIO_COST_PER_MINUTE`
  - `AI_AUDIO_TOKENS_PER_MINUTE`
  - `AI_AUDIO_AVG_BITRATE_KBPS`
  - `AI_COST_CURRENCY`

## Testes

- `npm run lint`: checagem de tipos
- `npm run build`: build frontend
- `npm test`: testes backend (Vitest + Supertest)
- `npm run test:smoke`: smoke frontend (Playwright, requer `E2E_BASE_URL`)

## Deploy SaaS em VPS

### 1. Preparar ambiente

1. Provisionar VPS Linux com Docker + Docker Compose.
2. Clonar repositorio no servidor.
3. Criar `.env.production` a partir de `.env.production.example`.
4. Definir dominio no DNS apontando para a VPS.
5. Garantir que `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` estejam preenchidas (usadas no build do frontend).
6. Definir tambem `ADMIN_URL`, `SUPERADMIN_ALLOWED_HOSTS`, `SUPERADMIN_BOOTSTRAP_USER_IDS` e `VITE_SUPERADMIN_DOMAINS` para habilitar o portal de superadmin em dominio separado.

### 2. Subir stack

- `docker compose --env-file .env.production up -d --build`

Servicos:
- `app`: API + frontend
- `caddy`: reverse proxy com HTTPS automatico

Dominios:
- `APP_URL` (portal da clinica)
- `ADMIN_URL` (portal superadmin, ex: `adminpsi.gccsoftware.com.br`)

### 3. Healthcheck e operacao

- Endpoint: `GET /api/health`
- Rollout sem downtime (imagem nova):
  - `docker compose --env-file .env.production pull app`
  - `docker compose --env-file .env.production up -d --remove-orphans`

## Job mensal (cron)

Script de suporte:
- `ops/run-monthly-billing.sh`

Exemplo de cron (dia 1, 02:00):

```bash
0 2 1 * * APP_INTERNAL_URL=http://127.0.0.1:3000 INTERNAL_JOB_TOKEN=... CLINIC_ID=... JOB_USER_ID=... /bin/sh /opt/smart-psi/ops/run-monthly-billing.sh >> /var/log/smartpsi-monthly.log 2>&1
```

## CI/CD

Workflow: `.github/workflows/ci-cd.yml`

- CI: `npm ci`, `lint`, `build`, `test`
- CD (main): build/push imagem no GHCR e deploy por SSH na VPS
- Deploy usa:
  - `docker compose --env-file .env.production pull app`
  - `docker compose --env-file .env.production up -d --remove-orphans`

Configure os secrets no GitHub:
- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`
- `VPS_DEPLOY_PATH`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SENTRY_DSN` (opcional)

## Observabilidade

- Logging estruturado por request com `x-request-id`.
- Sentry opcional:
  - backend: `SENTRY_DSN`
  - frontend: `VITE_SENTRY_DSN`

## Evolution Inbox (core)

- Integracao por clinica:
  - `GET /api/integrations/evolution/status`
  - `PUT /api/integrations/evolution/settings`
  - `POST /api/integrations/evolution/disconnect`
  - `POST /api/integrations/evolution/webhook?clinic_id=<uuid>`
- Caixa de atendimento:
  - `GET /api/inbox/threads`
  - `GET /api/inbox/threads/:threadId/messages`
  - `PATCH /api/inbox/threads/:threadId`
  - `POST /api/inbox/threads/:threadId/read`
  - `POST /api/inbox/threads/:threadId/messages`
