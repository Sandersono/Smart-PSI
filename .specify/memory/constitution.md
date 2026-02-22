# Smart PSI Constitution

## Core Principles

### I. Security and Privacy by Default
- Production auth is Bearer-only. Any dev bypass is forbidden in production.
- RBAC is enforced on backend first; frontend can only mirror backend permissions.
- Webhooks must be closed by default: missing token/config returns 503, invalid token returns 401.
- Secrets are never committed. Production secrets live outside git and are rotated.
- Logs must avoid clinical sensitive data and keep only operational context.

### II. Backend as Source of Truth
- All business rules for finance, permissions, and integrations are implemented server-side.
- UI must not bypass or duplicate canonical backend decisions.
- Financial consistency across `asaas_charges`, `financial_records`, and monthly summaries is mandatory.
- Integration features (Google/Asaas) are controlled by environment feature flags.

### III. Test and Release Gates (Non-Negotiable)
- Any change touching auth, RBAC, webhooks, finance, or scheduling requires automated tests.
- Minimum release gate for production:
  - `npm run lint` passes
  - `npm test` passes
  - `npm run build` passes
  - `npm audit --omit=dev` has no known high/critical vulnerabilities
- Critical bug fixes require regression tests in the same change.

### IV. Lean Ops and Reproducible Deploys
- Standard deployment target is Linux VPS with Docker Compose and Caddy TLS.
- Runtime health endpoint (`/api/health`) is required and used by orchestration.
- Deploy and rollback must be operationally simple for a lean team.
- Recurring internal jobs (monthly billing) must be authenticated and automatable by cron.

### V. Observability and Controlled Change
- Structured request logs with correlation/request id are required.
- Error monitoring (Sentry) is optional in development and recommended in production.
- Breaking changes to API/schema need migration scripts, rollout notes, and rollback path.
- Prefer simple, incremental changes over broad refactors without measurable benefit.

## Security and Compliance Requirements

- Default environment values must be secure (`ALLOW_DEV_USER_BYPASS=false`, integration flags off in production until enabled).
- CORS in production is explicit allow-list only.
- Rate limits are mandatory for sensitive routes.
- Clinical notes and protected patient data are role-scoped and minimized by least privilege.
- Infrastructure and operations must preserve LGPD-oriented access boundaries and incident traceability.

## Development Workflow and Quality Gates

- Work is done in small vertical slices: backend rules, frontend behavior, tests, docs.
- Every behavior change includes:
  - API/contract update
  - UI adjustment (if applicable)
  - test coverage
  - operational note in README/.env examples when needed
- CI must run lint/build/tests on pull requests and main branch pushes.
- Production deploys are gated by successful CI and canary/staging validation.

## Governance

- This constitution supersedes local ad-hoc practices when conflicts arise.
- Amendments require:
  - clear rationale
  - explicit migration/compatibility impact
  - version update and amendment date update
- Code reviews must explicitly verify constitution compliance for security, RBAC, testing, and deploy safety.

**Version**: 1.0.0 | **Ratified**: 2026-02-22 | **Last Amended**: 2026-02-22
