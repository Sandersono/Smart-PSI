# LGPD Operational Checklist - SmartPSI

Date: 2026-02-22  
Branch: `001-saas-go-live`

## Scope

Operational validation for SaaS go-live focusing on:
- minimization of sensitive data in logs
- role-based access control behavior
- incident traceability and auditability

## Results

- [x] Logs avoid clinical payload content
  - Request logs include: method, path, status, duration, request id.
  - No raw note text, transcript, or patient clinical fields are logged by default request middleware.
- [x] Request correlation id enabled
  - `x-request-id` generated and returned for each request.
  - Structured `request_start` and `request_end` records present.
- [x] Role-based access boundaries validated
  - Automated backend tests validate secretary restrictions:
    - no clinical notes in patient list/history
    - blocked write of patient clinical notes (`403`)
- [x] Webhook boundary validated
  - Webhooks reject missing token (`503`) and invalid token (`401`).
- [x] Financial consistency controls validated
  - Automated tests cover Asaas reconciliation matrix:
    - `PENDING`, `OVERDUE`, `RECEIVED`, `REFUNDED`
  - Monthly summary consistency validated after reconciliation transitions.
- [x] Incident traceability baseline present
  - Structured logs and optional Sentry integration available in backend and frontend.

## Pending Operational Items

- [ ] Run full Docker runtime validation with daemon active (`docker compose up -d`).
- [ ] Execute staging smoke against deployed URL.
- [ ] Perform 7-day canary monitoring with pilot clinics.

## Evidence

- Backend tests: `tests/backend/security-hardening.test.ts`
- E2E smoke: `tests/e2e/smoke.spec.ts`
- Server middleware and logging: `server.ts`
- Runtime/ops: `docker-compose.yml`, `ops/Caddyfile`, `ops/run-monthly-billing.sh`
