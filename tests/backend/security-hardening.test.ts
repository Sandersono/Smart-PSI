import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

type MockRow = Record<string, unknown>;
type MockDb = Record<string, MockRow[]>;

function cloneRow<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function pickColumns(row: MockRow, columns: string | null): MockRow {
  if (!columns || columns.trim() === "" || columns.includes("*")) {
    return cloneRow(row);
  }
  const fields = columns
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const picked: MockRow = {};
  for (const field of fields) {
    picked[field] = row[field];
  }
  return picked;
}

function parseLiteral(raw: string): unknown {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  const num = Number(raw);
  if (!Number.isNaN(num) && raw.trim() !== "") return num;
  return raw;
}

function createSupabaseMock(seed: Partial<MockDb> = {}) {
  const db: MockDb = {
    clinic_members: cloneRow(seed.clinic_members || []),
    clinics: cloneRow(seed.clinics || []),
    profiles: cloneRow(seed.profiles || []),
    patients: cloneRow(seed.patients || []),
    appointments: cloneRow(seed.appointments || []),
    financial_records: cloneRow(seed.financial_records || []),
    notes: cloneRow(seed.notes || []),
    asaas_charges: cloneRow(seed.asaas_charges || []),
    ...cloneRow(seed),
  };

  const counters = new Map<string, number>();
  const nextId = (table: string) => {
    const current = counters.get(table) || 1;
    counters.set(table, current + 1);
    return current;
  };
  const authUsers = cloneRow(seed.auth_users || []) as Array<{
    id: string;
    email?: string | null;
    user_metadata?: Record<string, unknown>;
  }>;

  const from = (table: string) => {
    if (!db[table]) db[table] = [];

    type Action = "select" | "insert" | "update" | "delete" | "upsert";
    let action: Action = "select";
    let payload: MockRow | MockRow[] | null = null;
    let selectedColumns: string | null = "*";
    let singleMode: "single" | "maybeSingle" | null = null;
    let upsertConflictKey: string | null = null;
    const predicates: Array<(row: MockRow) => boolean> = [];
    let sortField: string | null = null;
    let sortAscending = true;
    let limitCount: number | null = null;

    const finalize = (rows: MockRow[] | null) => {
      if (singleMode === "single") {
        if (!rows || rows.length === 0) {
          return { data: null, error: { message: "No rows" } };
        }
        return { data: rows[0], error: null };
      }
      if (singleMode === "maybeSingle") {
        return { data: rows && rows.length > 0 ? rows[0] : null, error: null };
      }
      if (rows === null) {
        return { data: null, error: null };
      }
      return { data: rows, error: null };
    };

    const applyPredicates = (rows: MockRow[]) => rows.filter((row) => predicates.every((fn) => fn(row)));

    const execute = async () => {
      const tableRows = db[table];

      if (action === "select") {
        let rows = applyPredicates(tableRows).map((row) => pickColumns(row, selectedColumns));
        if (sortField) {
          rows = rows.sort((a, b) => {
            const av = a[sortField as string];
            const bv = b[sortField as string];
            if (av === bv) return 0;
            if (av === undefined || av === null) return sortAscending ? -1 : 1;
            if (bv === undefined || bv === null) return sortAscending ? 1 : -1;
            return av > bv ? (sortAscending ? 1 : -1) : sortAscending ? -1 : 1;
          });
        }
        if (limitCount !== null) {
          rows = rows.slice(0, limitCount);
        }
        return finalize(rows);
      }

      if (action === "insert") {
        const incoming = Array.isArray(payload) ? payload : [payload];
        const inserted: MockRow[] = [];
        for (const raw of incoming) {
          const row = cloneRow(raw || {});
          if (row.id === undefined || row.id === null) {
            row.id = nextId(table);
          }
          tableRows.push(row);
          inserted.push(row);
        }
        const projected = selectedColumns === null ? null : inserted.map((row) => pickColumns(row, selectedColumns));
        return finalize(projected);
      }

      if (action === "update") {
        const target = applyPredicates(tableRows);
        for (const row of target) {
          const patch = payload || {};
          for (const [key, value] of Object.entries(patch)) {
            if (value !== undefined) {
              row[key] = value;
            }
          }
        }
        const projected = selectedColumns === null ? null : target.map((row) => pickColumns(row, selectedColumns));
        return finalize(projected);
      }

      if (action === "upsert") {
        const incoming = Array.isArray(payload) ? payload : [payload];
        const out: MockRow[] = [];
        const keys = (upsertConflictKey || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        for (const raw of incoming) {
          const row = cloneRow(raw || {});
          let existing: MockRow | undefined;
          if (keys.length > 0) {
            existing = tableRows.find((item) => keys.every((key) => item[key] === row[key]));
          }
          if (existing) {
            for (const [k, v] of Object.entries(row)) {
              if (v !== undefined) existing[k] = v;
            }
            out.push(existing);
          } else {
            if (row.id === undefined || row.id === null) {
              row.id = nextId(table);
            }
            tableRows.push(row);
            out.push(row);
          }
        }
        const projected = selectedColumns === null ? null : out.map((row) => pickColumns(row, selectedColumns));
        return finalize(projected);
      }

      if (action === "delete") {
        const removeSet = new Set(applyPredicates(tableRows));
        db[table] = tableRows.filter((row) => !removeSet.has(row));
        return finalize(selectedColumns === null ? null : []);
      }

      return finalize([]);
    };

    const query: Record<string, unknown> = {
      select: (columns = "*") => {
        selectedColumns = columns;
        return query;
      },
      insert: (rows: MockRow | MockRow[]) => {
        action = "insert";
        payload = rows;
        selectedColumns = null;
        return query;
      },
      update: (row: MockRow) => {
        action = "update";
        payload = row;
        selectedColumns = null;
        return query;
      },
      upsert: (rows: MockRow | MockRow[], options?: { onConflict?: string }) => {
        action = "upsert";
        payload = rows;
        selectedColumns = null;
        upsertConflictKey = options?.onConflict || null;
        return query;
      },
      delete: () => {
        action = "delete";
        selectedColumns = null;
        return query;
      },
      eq: (field: string, value: unknown) => {
        predicates.push((row) => row[field] === value);
        return query;
      },
      in: (field: string, values: unknown[]) => {
        const allowed = new Set(values);
        predicates.push((row) => allowed.has(row[field]));
        return query;
      },
      gte: (field: string, value: unknown) => {
        predicates.push((row) => String(row[field]) >= String(value));
        return query;
      },
      lt: (field: string, value: unknown) => {
        predicates.push((row) => String(row[field]) < String(value));
        return query;
      },
      gt: (field: string, value: unknown) => {
        predicates.push((row) => String(row[field]) > String(value));
        return query;
      },
      neq: (field: string, value: unknown) => {
        predicates.push((row) => row[field] !== value);
        return query;
      },
      not: (field: string, operator: string, expression: string) => {
        if (operator === "in") {
          const values = expression
            .replace(/^\(/, "")
            .replace(/\)$/, "")
            .split(",")
            .map((item) => parseLiteral(item.trim()));
          const blocked = new Set(values);
          predicates.push((row) => !blocked.has(row[field]));
        }
        return query;
      },
      limit: (value: number) => {
        limitCount = Number.isFinite(value) && value >= 0 ? value : null;
        return query;
      },
      order: (field: string, options?: { ascending?: boolean }) => {
        sortField = field;
        sortAscending = options?.ascending !== false;
        return query;
      },
      or: (expression: string) => {
        const clauses = expression
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        predicates.push((row) =>
          clauses.some((clause) => {
            const eqMatch = clause.match(/^([^.]*)\.eq\.(.+)$/);
            if (eqMatch) {
              return row[eqMatch[1]] === parseLiteral(eqMatch[2]);
            }
            const isNullMatch = clause.match(/^([^.]*)\.is\.null$/);
            if (isNullMatch) {
              return row[isNullMatch[1]] === null || row[isNullMatch[1]] === undefined;
            }
            return false;
          })
        );
        return query;
      },
      maybeSingle: () => {
        singleMode = "maybeSingle";
        return execute();
      },
      single: () => {
        singleMode = "single";
        return execute();
      },
      then: (onfulfilled: (value: unknown) => unknown, onrejected?: (reason: unknown) => unknown) =>
        execute().then(onfulfilled, onrejected),
    };

    return query;
  };

  const client = {
    from,
    auth: {
      getUser: vi.fn(async (token: string) => {
        if (token === "valid-token") {
          return { data: { user: { id: "token-user" } }, error: null };
        }
        return { data: { user: null }, error: { message: "Invalid token" } };
      }),
      admin: {
        getUserById: vi.fn(async (userId: string) => {
          const fromAuth = authUsers.find((item) => item.id === userId);
          if (fromAuth) {
            return { data: { user: cloneRow(fromAuth) }, error: null };
          }
          return {
            data: { user: { id: userId, email: `${userId}@example.com`, user_metadata: {} } },
            error: null,
          };
        }),
        listUsers: vi.fn(async (params?: { page?: number; perPage?: number }) => {
          const page = Math.max(1, Number(params?.page || 1));
          const perPage = Math.max(1, Number(params?.perPage || 1000));
          const start = (page - 1) * perPage;
          const users = authUsers.slice(start, start + perPage).map((item) => cloneRow(item));
          return { data: { users }, error: null };
        }),
        createUser: vi.fn(
          async (payload: {
            email?: string;
            password?: string;
            user_metadata?: Record<string, unknown>;
          }) => {
            const email = String(payload?.email || "")
              .trim()
              .toLowerCase();
            if (!email) {
              return { data: { user: null }, error: { message: "Email required" } };
            }
            if (authUsers.some((item) => String(item.email || "").toLowerCase() === email)) {
              return { data: { user: null }, error: { message: "User already exists" } };
            }
            const user = {
              id: `auth-user-${nextId("auth_users")}`,
              email,
              user_metadata: cloneRow(payload?.user_metadata || {}),
            };
            authUsers.push(user);
            return { data: { user: cloneRow(user) }, error: null };
          }
        ),
      },
    },
  };

  return { client, db };
}

async function createTestApp(options: {
  env?: Record<string, string | undefined>;
  seed?: Partial<MockDb>;
  mockGeminiResponseText?: string;
} = {}) {
  vi.resetModules();

  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  process.env.NODE_ENV = "production";
  process.env.ALLOW_DEV_USER_BYPASS = "false";
  process.env.FEATURE_GOOGLE_ENABLED = "true";
  process.env.FEATURE_ASAAS_ENABLED = "true";
  process.env.GOOGLE_WEBHOOK_TOKEN = "";
  process.env.ASAAS_WEBHOOK_TOKEN = "";
  process.env.SENTRY_DSN = "";
  process.env.GEMINI_API_KEY = "";
  process.env.CORS_ALLOWED_ORIGINS = "http://localhost:3000";
  process.env.RATE_LIMIT_WINDOW_MS = "900000";
  process.env.RATE_LIMIT_MAX = "500";

  for (const [key, value] of Object.entries(options.env || {})) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const { client, db } = createSupabaseMock(options.seed);
  vi.doMock("@supabase/supabase-js", () => ({
    createClient: vi.fn(() => client),
  }));
  if (options.mockGeminiResponseText !== undefined) {
    const responseText = options.mockGeminiResponseText;
    vi.doMock("@google/genai", () => ({
      GoogleGenAI: class MockGoogleGenAI {
        models = {
          generateContent: vi.fn(async () => ({ text: responseText })),
        };
      },
      Type: {
        OBJECT: "OBJECT",
        STRING: "STRING",
      },
    }));
  }

  const { createApp } = await import("../../server");
  const app = await createApp({ includeFrontend: false });
  return { app, db };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("backend hardening", () => {
  let app: Awaited<ReturnType<(typeof import("../../server"))["createApp"]>>;

  beforeAll(async () => {
    const created = await createTestApp({
      env: {
        NODE_ENV: "production",
        ALLOW_DEV_USER_BYPASS: "true",
        FEATURE_GOOGLE_ENABLED: "true",
        FEATURE_ASAAS_ENABLED: "true",
        GOOGLE_WEBHOOK_TOKEN: "",
        ASAAS_WEBHOOK_TOKEN: "",
      },
    });
    app = created.app;
  });

  it("requires bearer token in production /api/me", async () => {
    const response = await request(app).get("/api/me").set("x-user-id", "dev-bypass-user");
    expect(response.status).toBe(401);
  });

  it("rejects Google webhook when token is not configured", async () => {
    const response = await request(app)
      .post("/api/integrations/google/webhook")
      .set("x-goog-channel-token", "anything")
      .send({});
    expect(response.status).toBe(503);
    expect(String(response.body?.error || "")).toContain("not configured");
  });

  it("rejects Asaas webhook when token is not configured", async () => {
    const response = await request(app)
      .post("/api/asaas/webhook")
      .set("x-asaas-token", "anything")
      .send({});
    expect(response.status).toBe(503);
    expect(String(response.body?.error || "")).toContain("not configured");
  });
});

describe("webhook token validation when configured", () => {
  let app: Awaited<ReturnType<(typeof import("../../server"))["createApp"]>>;

  beforeAll(async () => {
    const created = await createTestApp({
      env: {
        NODE_ENV: "production",
        ALLOW_DEV_USER_BYPASS: "false",
        FEATURE_GOOGLE_ENABLED: "true",
        FEATURE_ASAAS_ENABLED: "true",
        GOOGLE_WEBHOOK_TOKEN: "google-secret-token",
        ASAAS_WEBHOOK_TOKEN: "asaas-secret-token",
      },
    });
    app = created.app;
  });

  it("returns 401 for invalid Google webhook token", async () => {
    const response = await request(app)
      .post("/api/integrations/google/webhook")
      .set("x-goog-channel-token", "wrong-token")
      .send({});
    expect(response.status).toBe(401);
  });

  it("returns 401 for invalid Asaas webhook token", async () => {
    const response = await request(app)
      .post("/api/asaas/webhook")
      .set("x-asaas-token", "wrong-token")
      .send({});
    expect(response.status).toBe(401);
  });
});

describe("superadmin authorization and tenant control", () => {
  it("denies superadmin endpoint for non-superadmin user", async () => {
    const { app } = await createTestApp({
      env: {
        NODE_ENV: "development",
        ALLOW_DEV_USER_BYPASS: "true",
      },
      seed: {
        platform_superadmins: [],
      },
    });

    const response = await request(app).get("/api/superadmin/me").set("x-user-id", "common-user");
    expect(response.status).toBe(403);
    expect(String(response.body?.error || "")).toContain("superadmin");
  });

  it("returns overview for authorized superadmin user", async () => {
    const { app } = await createTestApp({
      env: {
        NODE_ENV: "development",
        ALLOW_DEV_USER_BYPASS: "true",
      },
      seed: {
        platform_superadmins: [
          {
            user_id: "sa-user",
            active: true,
          },
        ],
        clinics: [
          {
            id: "clinic-1",
            name: "Clinica A",
            owner_user_id: "owner-a",
            created_at: "2026-02-01T00:00:00.000Z",
          },
          {
            id: "clinic-2",
            name: "Clinica B",
            owner_user_id: "owner-b",
            created_at: "2026-02-02T00:00:00.000Z",
          },
        ],
        tenant_subscriptions: [
          {
            clinic_id: "clinic-1",
            status: "active",
          },
          {
            clinic_id: "clinic-2",
            status: "suspended",
          },
        ],
        clinic_members: [
          {
            id: 1,
            clinic_id: "clinic-1",
            user_id: "owner-a",
            role: "admin",
            active: true,
          },
          {
            id: 2,
            clinic_id: "clinic-2",
            user_id: "owner-b",
            role: "admin",
            active: true,
          },
        ],
      },
    });

    const response = await request(app)
      .get("/api/superadmin/dashboard/overview")
      .set("x-user-id", "sa-user");
    expect(response.status).toBe(200);
    expect(response.body?.totals?.clinics_total).toBe(2);
    expect(response.body?.totals?.active).toBe(1);
    expect(response.body?.totals?.suspended).toBe(1);
    expect(response.body?.totals?.blocked).toBe(1);
  });

  it("creates clinic with existing owner email", async () => {
    const { app, db } = await createTestApp({
      env: {
        NODE_ENV: "development",
        ALLOW_DEV_USER_BYPASS: "true",
      },
      seed: {
        platform_superadmins: [
          {
            user_id: "sa-user",
            active: true,
          },
        ],
        auth_users: [
          {
            id: "owner-existing-id",
            email: "owner@smartpsi.com",
            user_metadata: { full_name: "Owner Existente" },
          },
        ],
      },
    });

    const response = await request(app)
      .post("/api/superadmin/clinics")
      .set("x-user-id", "sa-user")
      .send({
        name: "Clinica Nova",
        owner_email: "OWNER@SMARTPSI.COM",
        owner_full_name: "Owner Existente",
        plan_code: "starter",
        status: "trialing",
        billing_provider: "manual",
        enabled_features: ["billing.asaas", "messaging.inbox"],
      });

    expect(response.status).toBe(201);
    expect(response.body?.clinic?.name).toBe("Clinica Nova");
    expect(response.body?.owner?.created).toBe(false);
    expect(response.body?.owner?.user_id).toBe("owner-existing-id");
    expect(db.clinics).toHaveLength(1);
    const createdClinicId = String(db.clinics[0].id);
    expect(db.clinics[0]).toMatchObject({
      name: "Clinica Nova",
      owner_user_id: "owner-existing-id",
    });
    expect(db.clinic_members[0]).toMatchObject({
      clinic_id: createdClinicId,
      user_id: "owner-existing-id",
      role: "admin",
      active: true,
    });
    expect(db.tenant_subscriptions[0]).toMatchObject({
      clinic_id: createdClinicId,
      plan_code: "starter",
      status: "trialing",
      billing_provider: "manual",
    });
    expect(db.tenant_feature_flags).toHaveLength(2);
  });

  it("creates clinic and owner auth user when owner email is missing", async () => {
    const { app, db } = await createTestApp({
      env: {
        NODE_ENV: "development",
        ALLOW_DEV_USER_BYPASS: "true",
      },
      seed: {
        platform_superadmins: [
          {
            user_id: "sa-user",
            active: true,
          },
        ],
      },
    });

    const response = await request(app)
      .post("/api/superadmin/clinics")
      .set("x-user-id", "sa-user")
      .send({
        name: "Clinica Auto Owner",
        owner_email: "novo.owner@smartpsi.com",
        owner_full_name: "Novo Owner",
        owner_password: "SenhaTemp@123",
        create_owner_if_missing: true,
        plan_code: "professional",
        status: "active",
        billing_provider: "asaas",
        enabled_features: ["billing.asaas"],
      });

    expect(response.status).toBe(201);
    expect(response.body?.owner?.created).toBe(true);
    expect(response.body?.owner?.temporary_password).toBe("SenhaTemp@123");
    expect(String(response.body?.owner?.user_id || "")).toContain("auth-user-");
    expect(db.clinics).toHaveLength(1);
    const createdClinicId = String(db.clinics[0].id);
    expect(db.clinics[0]).toMatchObject({
      name: "Clinica Auto Owner",
      owner_user_id: response.body?.owner?.user_id,
    });
    expect(db.clinic_members[0]).toMatchObject({
      clinic_id: createdClinicId,
      user_id: response.body?.owner?.user_id,
      role: "admin",
      active: true,
    });
    expect(db.tenant_subscriptions[0]).toMatchObject({
      clinic_id: createdClinicId,
      plan_code: "professional",
      status: "active",
      billing_provider: "asaas",
    });
  });
});

describe("tenant subscription Asaas sync", () => {
  it("reconciles tenant subscription status from Asaas webhook payload", async () => {
    const clinicId = "11111111-1111-4111-8111-111111111111";
    const { app, db } = await createTestApp({
      env: {
        NODE_ENV: "production",
        FEATURE_ASAAS_ENABLED: "true",
        ASAAS_WEBHOOK_TOKEN: "asaas-secret-token",
      },
      seed: {
        clinics: [
          {
            id: clinicId,
            name: "Clinica SaaS",
            owner_user_id: "owner-sa",
            created_at: "2026-02-01T00:00:00.000Z",
          },
        ],
        tenant_subscriptions: [
          {
            clinic_id: clinicId,
            status: "active",
            billing_provider: "manual",
            asaas_customer_id: "cus_1",
            asaas_subscription_id: "sub_1",
            plan_code: "starter",
          },
        ],
      },
    });

    const response = await request(app)
      .post("/api/asaas/webhook")
      .set("x-asaas-token", "asaas-secret-token")
      .send({
        event: "SUBSCRIPTION_OVERDUE",
        subscription: {
          id: "sub_1",
          status: "OVERDUE",
          customer: "cus_1",
          nextDueDate: "2026-03-20",
        },
      });

    expect(response.status).toBe(200);
    expect(response.body?.tenant_subscription?.clinic_id).toBe(clinicId);
    expect(response.body?.tenant_subscription?.status).toBe("past_due");

    expect(db.tenant_subscriptions[0]).toMatchObject({
      clinic_id: clinicId,
      status: "past_due",
      billing_provider: "asaas",
      asaas_customer_id: "cus_1",
      asaas_subscription_id: "sub_1",
    });
  });

  it("syncs tenant subscription from Asaas on superadmin endpoint", async () => {
    const clinicId = "22222222-2222-4222-8222-222222222222";
    const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/subscriptions/sub_sync_1")) {
        return new Response(
          JSON.stringify({
            id: "sub_sync_1",
            status: "ACTIVE",
            customer: "cus_sync_1",
            nextDueDate: "2026-03-30",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const { app, db } = await createTestApp({
      env: {
        NODE_ENV: "development",
        ALLOW_DEV_USER_BYPASS: "true",
        FEATURE_ASAAS_ENABLED: "true",
        ASAAS_API_KEY: "asaas-test-key",
      },
      seed: {
        platform_superadmins: [
          {
            user_id: "sa-user",
            active: true,
          },
        ],
        clinics: [
          {
            id: clinicId,
            name: "Clinica Sync",
            owner_user_id: "owner-sync",
            created_at: "2026-02-01T00:00:00.000Z",
          },
        ],
        tenant_subscriptions: [
          {
            clinic_id: clinicId,
            status: "past_due",
            billing_provider: "asaas",
            asaas_customer_id: "cus_sync_1",
            asaas_subscription_id: "sub_sync_1",
            plan_code: "starter",
          },
        ],
      },
    });

    const response = await request(app)
      .post(`/api/superadmin/clinics/${clinicId}/asaas/sync-subscription`)
      .set("x-user-id", "sa-user")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body?.subscription?.status).toBe("active");
    expect(response.body?.asaas?.id).toBe("sub_sync_1");
    expect(db.tenant_subscriptions[0]?.status).toBe("active");

    vi.unstubAllGlobals();
  });
});

describe("tenant subscription access lock", () => {
  it("blocks clinic access when tenant status is suspended", async () => {
    const { app } = await createTestApp({
      env: {
        NODE_ENV: "development",
        ALLOW_DEV_USER_BYPASS: "true",
      },
      seed: {
        clinic_members: [
          {
            id: 1,
            clinic_id: "clinic-1",
            user_id: "pro-user",
            role: "professional",
            active: true,
            created_at: "2026-02-01T00:00:00.000Z",
          },
        ],
        clinics: [
          {
            id: "clinic-1",
            status: "active",
            subscription_status: "suspended",
          },
        ],
        profiles: [
          {
            id: "pro-user",
            clinic_id: "clinic-1",
            role: "professional",
          },
        ],
        tenant_subscriptions: [
          {
            clinic_id: "clinic-1",
            status: "suspended",
            suspended_reason: "inadimplencia",
          },
        ],
      },
    });

    const response = await request(app).get("/api/me").set("x-user-id", "pro-user");
    expect(response.status).toBe(403);
    expect(String(response.body?.error || "")).toContain("Subscription suspended");
  });

  it("allows clinic access on past_due while grace period is valid", async () => {
    const { app } = await createTestApp({
      env: {
        NODE_ENV: "development",
        ALLOW_DEV_USER_BYPASS: "true",
      },
      seed: {
        clinic_members: [
          {
            id: 1,
            clinic_id: "clinic-1",
            user_id: "pro-user",
            role: "professional",
            active: true,
            created_at: "2026-02-01T00:00:00.000Z",
          },
        ],
        clinics: [
          {
            id: "clinic-1",
            status: "active",
            subscription_status: "past_due",
          },
        ],
        profiles: [
          {
            id: "pro-user",
            clinic_id: "clinic-1",
            role: "professional",
          },
        ],
        tenant_subscriptions: [
          {
            clinic_id: "clinic-1",
            status: "past_due",
            payment_grace_until: "2099-02-01T00:00:00.000Z",
          },
        ],
      },
    });

    const response = await request(app).get("/api/me").set("x-user-id", "pro-user");
    expect(response.status).toBe(200);
    expect(response.body?.profile?.clinic_id).toBe("clinic-1");
  });
});

describe("Evolution inbox core", () => {
  it("ingests evolution webhook and creates inbox thread/message", async () => {
    const clinicId = "33333333-3333-4333-8333-333333333333";
    const { app, db } = await createTestApp({
      env: {
        NODE_ENV: "production",
        FEATURE_GOOGLE_ENABLED: "false",
        FEATURE_ASAAS_ENABLED: "false",
      },
      seed: {
        clinic_evolution_connections: [
          {
            clinic_id: clinicId,
            api_base_url: "https://evolution.example",
            instance_name: "smartpsi",
            api_token_encrypted: "encrypted-token",
            webhook_secret: "evo-secret",
            status: "connected",
          },
        ],
      },
    });

    const response = await request(app)
      .post(`/api/integrations/evolution/webhook?clinic_id=${clinicId}`)
      .set("x-evolution-token", "evo-secret")
      .send({
        event: "messages.upsert",
        data: {
          key: {
            id: "msg_ext_1",
            remoteJid: "5511999999999@s.whatsapp.net",
            fromMe: false,
          },
          pushName: "Contato Teste",
          messageTimestamp: 1760000000,
          message: {
            conversation: "Ola, preciso de ajuda",
          },
        },
      });

    expect(response.status).toBe(200);
    expect(response.body?.success).toBe(true);
    expect(db.inbox_threads.length).toBe(1);
    expect(db.inbox_messages.length).toBe(1);
    expect(db.inbox_threads[0]).toMatchObject({
      clinic_id: clinicId,
      external_thread_id: "5511999999999@s.whatsapp.net",
      contact_name: "Contato Teste",
      unread_count: 1,
    });
    expect(db.inbox_messages[0]).toMatchObject({
      clinic_id: clinicId,
      direction: "inbound",
      content: "Ola, preciso de ajuda",
      external_message_id: "msg_ext_1",
    });
  });

  it("lists inbox threads only for current clinic and marks thread as read", async () => {
    const clinicOne = "44444444-4444-4444-8444-444444444444";
    const clinicTwo = "55555555-5555-4555-8555-555555555555";
    const { app, db } = await createTestApp({
      env: {
        NODE_ENV: "development",
        ALLOW_DEV_USER_BYPASS: "true",
      },
      seed: {
        clinic_members: [
          {
            id: 1,
            clinic_id: clinicOne,
            user_id: "pro-user",
            role: "professional",
            active: true,
            created_at: "2026-02-01T00:00:00.000Z",
          },
        ],
        inbox_threads: [
          {
            id: 701,
            clinic_id: clinicOne,
            channel: "whatsapp",
            external_thread_id: "5511888888888@s.whatsapp.net",
            contact_name: "Thread Clinica 1",
            status: "open",
            unread_count: 3,
            labels: [],
            updated_at: "2026-02-01T00:00:00.000Z",
          },
          {
            id: 702,
            clinic_id: clinicTwo,
            channel: "whatsapp",
            external_thread_id: "5511777777777@s.whatsapp.net",
            contact_name: "Thread Clinica 2",
            status: "open",
            unread_count: 5,
            labels: [],
            updated_at: "2026-02-01T00:00:00.000Z",
          },
        ],
      },
    });

    const listResponse = await request(app).get("/api/inbox/threads").set("x-user-id", "pro-user");
    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body?.threads)).toBe(true);
    expect(listResponse.body?.threads).toHaveLength(1);
    expect(listResponse.body?.threads[0]?.id).toBe(701);

    const readResponse = await request(app)
      .post("/api/inbox/threads/701/read")
      .set("x-user-id", "pro-user")
      .send({});
    expect(readResponse.status).toBe(200);
    expect(readResponse.body?.success).toBe(true);
    expect(db.inbox_threads.find((item) => Number(item.id) === 701)?.unread_count).toBe(0);
  });

  it("sends outbound inbox message through evolution endpoint", async () => {
    const clinicId = "66666666-6666-4666-8666-666666666666";
    const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/message/sendText/smartpsi-inst")) {
        return new Response(
          JSON.stringify({
            id: "provider-msg-1",
            key: {
              id: "provider-msg-1",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const { app, db } = await createTestApp({
      env: {
        NODE_ENV: "development",
        ALLOW_DEV_USER_BYPASS: "true",
      },
      seed: {
        clinic_members: [
          {
            id: 1,
            clinic_id: clinicId,
            user_id: "admin-user",
            role: "admin",
            active: true,
            created_at: "2026-02-01T00:00:00.000Z",
          },
        ],
        inbox_threads: [
          {
            id: 801,
            clinic_id: clinicId,
            channel: "whatsapp",
            external_thread_id: "5511999999999@s.whatsapp.net",
            contact_name: "Paciente Mensagem",
            status: "open",
            unread_count: 0,
            labels: [],
            updated_at: "2026-02-01T00:00:00.000Z",
          },
        ],
      },
    });

    const configResponse = await request(app)
      .put("/api/integrations/evolution/settings")
      .set("x-user-id", "admin-user")
      .send({
        api_base_url: "https://evolution.example",
        instance_name: "smartpsi-inst",
        api_token: "token-evolution-123",
        webhook_secret: "secret-abc",
      });
    expect(configResponse.status).toBe(200);

    const sendResponse = await request(app)
      .post("/api/inbox/threads/801/messages")
      .set("x-user-id", "admin-user")
      .send({ content: "Mensagem de teste" });
    expect(sendResponse.status).toBe(201);
    expect(sendResponse.body?.message?.direction).toBe("outbound");

    expect(fetchMock).toHaveBeenCalled();
    const sendCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("/message/sendText/smartpsi-inst")
    );
    expect(sendCall).toBeTruthy();

    const sendBodyRaw = (sendCall?.[1] as RequestInit | undefined)?.body;
    const sendBody =
      typeof sendBodyRaw === "string" && sendBodyRaw.length > 0 ? JSON.parse(sendBodyRaw) : {};
    expect(sendBody.number).toBe("5511999999999");
    expect(sendBody.text).toBe("Mensagem de teste");

    const outbound = db.inbox_messages.find(
      (item) => Number(item.thread_id) === 801 && String(item.direction) === "outbound"
    );
    expect(outbound).toBeTruthy();
    expect(outbound?.status).toBe("sent");

    vi.unstubAllGlobals();
  });
});

describe("RBAC for secretary", () => {
  let app: Awaited<ReturnType<(typeof import("../../server"))["createApp"]>>;

  beforeAll(async () => {
    const created = await createTestApp({
      env: {
        NODE_ENV: "development",
        ALLOW_DEV_USER_BYPASS: "true",
      },
      seed: {
        clinic_members: [
          {
            id: 1,
            clinic_id: "clinic-1",
            user_id: "sec-user",
            role: "secretary",
            active: true,
            created_at: "2026-02-01T00:00:00.000Z",
          },
        ],
        patients: [
          {
            id: 11,
            clinic_id: "clinic-1",
            user_id: "pro-user",
            name: "Paciente A",
            notes: "conteudo clinico sensivel",
            session_fee: 220,
          },
        ],
        appointments: [
          {
            id: 101,
            clinic_id: "clinic-1",
            patient_id: 11,
            secondary_patient_id: null,
            start_time: "2026-02-10T15:00:00.000Z",
          },
        ],
        financial_records: [
          {
            id: 301,
            clinic_id: "clinic-1",
            patient_id: 11,
            type: "income",
            status: "paid",
            amount: 220,
            date: "2026-02-10T18:00:00.000Z",
          },
        ],
        notes: [
          {
            id: 501,
            clinic_id: "clinic-1",
            patient_id: 11,
            complaint: "Nao deve aparecer para secretaria",
          },
        ],
      },
    });
    app = created.app;
  });

  it("hides clinical notes in /api/patients list for secretary", async () => {
    const response = await request(app).get("/api/patients").set("x-user-id", "sec-user");
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body[0]?.notes).toBeNull();
    expect(response.body[0]?.session_count).toBe(1);
  });

  it("does not expose clinical timeline notes in /api/patients/:id/history for secretary", async () => {
    const response = await request(app)
      .get("/api/patients/11/history")
      .set("x-user-id", "sec-user");
    expect(response.status).toBe(200);
    expect(response.body?.notes).toEqual([]);
    expect(Array.isArray(response.body?.appointments)).toBe(true);
    expect(Array.isArray(response.body?.financial)).toBe(true);
  });

  it("blocks secretary from updating patient clinical notes", async () => {
    const response = await request(app).put("/api/patients/11").set("x-user-id", "sec-user").send({
      name: "Paciente A",
      notes: "tentativa de editar conteudo clinico",
    });
    expect(response.status).toBe(403);
    expect(String(response.body?.error || "")).toContain("Secretary cannot update clinical");
  });
});

describe("Asaas webhook reconciliation", () => {
  let app: Awaited<ReturnType<(typeof import("../../server"))["createApp"]>>;
  let db: MockDb;

  beforeAll(async () => {
    const created = await createTestApp({
      env: {
        NODE_ENV: "production",
        FEATURE_ASAAS_ENABLED: "true",
        ASAAS_WEBHOOK_TOKEN: "asaas-secret-token",
      },
      seed: {
        patients: [
          {
            id: 21,
            clinic_id: "clinic-1",
            user_id: "pro-user",
            name: "Paciente Financeiro",
            session_fee: 199.9,
          },
        ],
        asaas_charges: [
          {
            id: 901,
            clinic_id: "clinic-1",
            patient_id: 21,
            appointment_id: 401,
            asaas_charge_id: "ch_123",
            status: "PENDING",
            value: 199.9,
            due_date: "2026-02-20",
            billing_mode: "session",
            updated_at: "2026-02-20T00:00:00.000Z",
          },
        ],
      },
    });
    app = created.app;
    db = created.db;
  });

  it("reconciles PENDING, OVERDUE, RECEIVED and REFUNDED to financial_records", async () => {
    const matrix = [
      {
        event: "PAYMENT_CREATED",
        status: "PENDING",
        expectedFinancialStatus: "pending",
        paymentDate: undefined,
        dueDate: "2026-02-20",
      },
      {
        event: "PAYMENT_OVERDUE",
        status: "OVERDUE",
        expectedFinancialStatus: "pending",
        paymentDate: undefined,
        dueDate: "2026-02-21",
      },
      {
        event: "PAYMENT_RECEIVED",
        status: "RECEIVED",
        expectedFinancialStatus: "paid",
        paymentDate: "2026-02-22",
        dueDate: "2026-02-22",
      },
      {
        event: "PAYMENT_REFUNDED",
        status: "REFUNDED",
        expectedFinancialStatus: "pending",
        paymentDate: undefined,
        dueDate: "2026-02-23",
      },
    ] as const;

    for (const step of matrix) {
      const response = await request(app)
        .post("/api/asaas/webhook")
        .set("x-asaas-token", "asaas-secret-token")
        .send({
          event: step.event,
          payment: {
            id: "ch_123",
            status: step.status,
            value: 199.9,
            paymentDate: step.paymentDate,
            dueDate: step.dueDate,
          },
        });

      expect(response.status).toBe(200);
      expect(db.financial_records.length).toBe(1);
      expect(db.financial_records[0]).toMatchObject({
        clinic_id: "clinic-1",
        patient_id: 21,
        type: "income",
        category: "Sessao Asaas",
        description: "Asaas charge ch_123",
        amount: 199.9,
        status: step.expectedFinancialStatus,
      });
      expect(db.asaas_charges[0]?.status).toBe(step.status);
      expect(db.asaas_charges[0]?.due_date).toBe(step.dueDate);
    }
  });

  it("returns accepted when charge id is unknown locally", async () => {
    const response = await request(app)
      .post("/api/asaas/webhook")
      .set("x-asaas-token", "asaas-secret-token")
      .send({
        event: "PAYMENT_RECEIVED",
        payment: { id: "missing-local-charge", status: "RECEIVED", value: 150 },
      });

    expect(response.status).toBe(202);
    expect(String(response.body?.reason || "")).toContain("not tracked locally");
  });
});

describe("session fee billing source", () => {
  let app: Awaited<ReturnType<(typeof import("../../server"))["createApp"]>>;
  let db: MockDb;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/payments")) {
        return new Response(JSON.stringify({ id: "pay_999", status: "PENDING" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/customers")) {
        return new Response(JSON.stringify({ id: "cus_999" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const created = await createTestApp({
      env: {
        NODE_ENV: "development",
        ALLOW_DEV_USER_BYPASS: "true",
        FEATURE_ASAAS_ENABLED: "true",
        FEATURE_GOOGLE_ENABLED: "false",
        ASAAS_API_KEY: "asaas-test-key",
      },
      seed: {
        clinic_members: [
          {
            id: 1,
            clinic_id: "clinic-1",
            user_id: "pro-user",
            role: "professional",
            active: true,
            created_at: "2026-02-01T00:00:00.000Z",
          },
        ],
        patients: [
          {
            id: 55,
            clinic_id: "clinic-1",
            user_id: "pro-user",
            name: "Paciente Sessao",
            session_fee: 321.45,
            billing_mode_override: "session",
          },
        ],
        patient_billing_profile: [
          {
            id: 8,
            clinic_id: "clinic-1",
            patient_id: 55,
            asaas_customer_id: "cus_existing",
          },
        ],
      },
    });
    app = created.app;
    db = created.db;
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("uses patients.session_fee when creating Asaas charge for appointment", async () => {
    const response = await request(app).post("/api/appointments").set("x-user-id", "pro-user").send({
      patient_id: 55,
      provider_user_id: "pro-user",
      start_time: "2026-03-01T10:00:00.000Z",
      status: "scheduled",
      session_type: "individual",
      session_mode: "in_person",
    });

    expect(response.status).toBe(201);

    const paymentCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/payments"));
    expect(paymentCall).toBeTruthy();

    const paymentBodyRaw = (paymentCall?.[1] as RequestInit | undefined)?.body;
    const paymentBody =
      typeof paymentBodyRaw === "string" && paymentBodyRaw.length > 0
        ? JSON.parse(paymentBodyRaw)
        : {};
    expect(paymentBody.value).toBe(321.45);

    expect(db.asaas_charges.length).toBe(1);
    expect(db.asaas_charges[0]?.value).toBe(321.45);
  });

  it("uses fallback session value only when patient session_fee is not positive", async () => {
    db.patients.push({
      id: 56,
      clinic_id: "clinic-1",
      user_id: "pro-user",
      name: "Paciente Sem Valor",
      session_fee: 0,
      billing_mode_override: "session",
    });
    db.patient_billing_profile = db.patient_billing_profile || [];
    db.patient_billing_profile.push({
      id: 9,
      clinic_id: "clinic-1",
      patient_id: 56,
      asaas_customer_id: "cus_fallback",
    });

    const response = await request(app).post("/api/appointments").set("x-user-id", "pro-user").send({
      patient_id: 56,
      provider_user_id: "pro-user",
      start_time: "2026-03-01T12:00:00.000Z",
      status: "scheduled",
      session_type: "individual",
      session_mode: "in_person",
    });

    expect(response.status).toBe(201);

    const paymentCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes("/payments"));
    const lastPaymentCall = paymentCalls[paymentCalls.length - 1];
    expect(lastPaymentCall).toBeTruthy();

    const paymentBodyRaw = (lastPaymentCall?.[1] as RequestInit | undefined)?.body;
    const paymentBody =
      typeof paymentBodyRaw === "string" && paymentBodyRaw.length > 0
        ? JSON.parse(paymentBodyRaw)
        : {};
    expect(paymentBody.value).toBe(150);

    const createdCharge = db.asaas_charges.find((row) => Number(row.patient_id) === 56);
    expect(createdCharge?.value).toBe(150);
  });
});

describe("appointment cancellation reconciles linked Asaas charge", () => {
  let app: Awaited<ReturnType<(typeof import("../../server"))["createApp"]>>;
  let db: MockDb;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/payments/")) {
        return new Response(JSON.stringify({ deleted: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const created = await createTestApp({
      env: {
        NODE_ENV: "development",
        ALLOW_DEV_USER_BYPASS: "true",
        FEATURE_ASAAS_ENABLED: "true",
        FEATURE_GOOGLE_ENABLED: "false",
        ASAAS_API_KEY: "asaas-test-key",
      },
      seed: {
        clinic_members: [
          {
            id: 1,
            clinic_id: "clinic-1",
            user_id: "pro-user",
            role: "professional",
            active: true,
            created_at: "2026-02-01T00:00:00.000Z",
          },
        ],
        patients: [
          {
            id: 77,
            clinic_id: "clinic-1",
            user_id: "pro-user",
            name: "Paciente Cancelamento",
            session_fee: 180,
          },
        ],
        appointments: [
          {
            id: 700,
            clinic_id: "clinic-1",
            user_id: "pro-user",
            provider_user_id: "pro-user",
            patient_id: 77,
            series_id: null,
            series_sequence: null,
            start_time: "2026-03-03T10:00:00.000Z",
            google_event_id: null,
            google_calendar_id: null,
          },
        ],
        asaas_charges: [
          {
            id: 990,
            clinic_id: "clinic-1",
            patient_id: 77,
            appointment_id: 700,
            asaas_charge_id: "pay_cancel_1",
            status: "PENDING",
            value: 180,
            due_date: "2026-03-03",
            billing_mode: "session",
          },
        ],
        financial_records: [
          {
            id: 4500,
            clinic_id: "clinic-1",
            user_id: "pro-user",
            patient_id: 77,
            amount: 180,
            type: "income",
            category: "Sessao Asaas",
            description: "Asaas charge pay_cancel_1",
            date: "2026-03-03T00:00:00.000Z",
            status: "paid",
          },
        ],
      },
    });
    app = created.app;
    db = created.db;
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("cancels linked charge and reconciles financial record on appointment delete", async () => {
    const response = await request(app).delete("/api/appointments/700").set("x-user-id", "pro-user");
    expect(response.status).toBe(200);
    expect(response.body?.success).toBe(true);

    const deletePaymentCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("/payments/pay_cancel_1")
    );
    expect(deletePaymentCall).toBeTruthy();

    expect(db.appointments.some((item) => Number(item.id) === 700)).toBe(false);
    expect(db.asaas_charges[0]?.status).toBe("CANCELLED");
    expect(db.financial_records[0]?.status).toBe("pending");
  });
});

describe("monthly summary consistency after Asaas reconciliation", () => {
  let app: Awaited<ReturnType<(typeof import("../../server"))["createApp"]>>;

  beforeAll(async () => {
    const created = await createTestApp({
      env: {
        NODE_ENV: "development",
        ALLOW_DEV_USER_BYPASS: "true",
        FEATURE_ASAAS_ENABLED: "true",
        ASAAS_WEBHOOK_TOKEN: "asaas-secret-token",
      },
      seed: {
        clinic_members: [
          {
            id: 1,
            clinic_id: "clinic-1",
            user_id: "pro-user",
            role: "professional",
            active: true,
            created_at: "2026-02-01T00:00:00.000Z",
          },
        ],
        patients: [
          {
            id: 88,
            clinic_id: "clinic-1",
            user_id: "pro-user",
            name: "Paciente Mensal",
            session_fee: 100,
          },
        ],
        appointments: [
          {
            id: 801,
            clinic_id: "clinic-1",
            patient_id: 88,
            status: "scheduled",
            start_time: "2026-03-05T10:00:00.000Z",
          },
          {
            id: 802,
            clinic_id: "clinic-1",
            patient_id: 88,
            status: "completed",
            start_time: "2026-03-12T10:00:00.000Z",
          },
        ],
        asaas_charges: [
          {
            id: 980,
            clinic_id: "clinic-1",
            patient_id: 88,
            appointment_id: 801,
            asaas_charge_id: "ch_monthly_1",
            status: "PENDING",
            value: 100,
            due_date: "2026-03-10",
            billing_mode: "session",
          },
        ],
      },
    });
    app = created.app;
  });

  it("keeps monthly paid/outstanding aligned when webhook changes status", async () => {
    const received = await request(app)
      .post("/api/asaas/webhook")
      .set("x-asaas-token", "asaas-secret-token")
      .send({
        event: "PAYMENT_RECEIVED",
        payment: {
          id: "ch_monthly_1",
          status: "RECEIVED",
          value: 100,
          paymentDate: "2026-03-10",
          dueDate: "2026-03-10",
        },
      });
    expect(received.status).toBe(200);

    const paidSummary = await request(app)
      .get("/api/financial/patient/88/monthly-summary")
      .set("x-user-id", "pro-user")
      .query({ month: "2026-03" });
    expect(paidSummary.status).toBe(200);
    expect(paidSummary.body?.gross_amount).toBe(200);
    expect(paidSummary.body?.paid_amount).toBe(100);
    expect(paidSummary.body?.outstanding_amount).toBe(100);

    const refunded = await request(app)
      .post("/api/asaas/webhook")
      .set("x-asaas-token", "asaas-secret-token")
      .send({
        event: "PAYMENT_REFUNDED",
        payment: {
          id: "ch_monthly_1",
          status: "REFUNDED",
          value: 100,
          dueDate: "2026-03-10",
        },
      });
    expect(refunded.status).toBe(200);

    const refundedSummary = await request(app)
      .get("/api/financial/patient/88/monthly-summary")
      .set("x-user-id", "pro-user")
      .query({ month: "2026-03" });
    expect(refundedSummary.status).toBe(200);
    expect(refundedSummary.body?.gross_amount).toBe(200);
    expect(refundedSummary.body?.paid_amount).toBe(0);
    expect(refundedSummary.body?.outstanding_amount).toBe(200);
  });
});

describe("AI usage metering", () => {
  let app: Awaited<ReturnType<(typeof import("../../server"))["createApp"]>>;
  let db: MockDb;

  beforeAll(async () => {
    const created = await createTestApp({
      env: {
        NODE_ENV: "development",
        ALLOW_DEV_USER_BYPASS: "true",
        GEMINI_API_KEY: "test-gemini-key",
        AI_MODEL_NAME: "gemini-2.5-flash",
        AI_TOKEN_COST_PER_MILLION: "7",
        AI_AUDIO_COST_PER_MINUTE: "0.25",
        AI_AUDIO_TOKENS_PER_MINUTE: "900",
        AI_AUDIO_AVG_BITRATE_KBPS: "64",
      },
      seed: {
        clinic_members: [
          {
            id: 1,
            clinic_id: "clinic-1",
            user_id: "pro-user",
            role: "professional",
            active: true,
            created_at: "2026-02-01T00:00:00.000Z",
          },
        ],
        patients: [
          {
            id: 333,
            clinic_id: "clinic-1",
            user_id: "pro-user",
            name: "Paciente IA",
          },
        ],
      },
      mockGeminiResponseText:
        '{"complaint":"Queixa principal","intervention":"Intervencao registrada","next_focus":"Proximo foco"}',
    });
    app = created.app;
    db = created.db;
  });

  it("registers AI usage event when processing audio note", async () => {
    const response = await request(app).post("/api/ai/process-audio").set("x-user-id", "pro-user").send({
      audioBase64: Buffer.from("audio-bytes-test").toString("base64"),
      mimeType: "audio/webm",
      patient_id: 333,
      preferences: {
        tone: "clinical",
        length: "short",
      },
    });

    expect(response.status).toBe(200);
    expect(response.body?.complaint).toBeTruthy();
    expect(response.body?.usage?.model).toBe("gemini-2.5-flash");
    expect(Number(response.body?.usage?.total_tokens_estimated || 0)).toBeGreaterThan(0);

    expect(Array.isArray(db.ai_usage_events)).toBe(true);
    expect(db.ai_usage_events.length).toBe(1);
    expect(db.ai_usage_events[0]).toMatchObject({
      clinic_id: "clinic-1",
      user_id: "pro-user",
      patient_id: 333,
      operation: "audio_transcription",
      provider: "google",
      model: "gemini-2.5-flash",
      status: "success",
    });
  });
});

describe("AI usage summary endpoint", () => {
  let app: Awaited<ReturnType<(typeof import("../../server"))["createApp"]>>;

  beforeAll(async () => {
    const created = await createTestApp({
      env: {
        NODE_ENV: "development",
        ALLOW_DEV_USER_BYPASS: "true",
      },
      seed: {
        clinic_members: [
          {
            id: 1,
            clinic_id: "clinic-1",
            user_id: "pro-user",
            role: "professional",
            active: true,
            created_at: "2026-02-01T00:00:00.000Z",
          },
          {
            id: 2,
            clinic_id: "clinic-1",
            user_id: "sec-user",
            role: "secretary",
            active: true,
            created_at: "2026-02-01T00:00:00.000Z",
          },
        ],
        ai_usage_events: [
          {
            id: 1,
            clinic_id: "clinic-1",
            user_id: "pro-user",
            operation: "audio_transcription",
            provider: "google",
            model: "gemini-2.5-flash",
            status: "success",
            input_audio_bytes: 1000,
            input_seconds: 12.5,
            input_tokens_estimated: 210,
            output_tokens_estimated: 80,
            total_tokens_estimated: 290,
            estimated_cost: 0.0123,
            currency: "BRL",
            created_at: "2026-04-02T10:00:00.000Z",
          },
          {
            id: 2,
            clinic_id: "clinic-1",
            user_id: "pro-user",
            operation: "audio_transcription",
            provider: "google",
            model: "gemini-2.5-pro",
            status: "failed",
            input_audio_bytes: 500,
            input_seconds: 6,
            input_tokens_estimated: 120,
            output_tokens_estimated: 0,
            total_tokens_estimated: 120,
            estimated_cost: 0.0045,
            currency: "BRL",
            created_at: "2026-04-08T14:00:00.000Z",
          },
          {
            id: 3,
            clinic_id: "clinic-1",
            user_id: "pro-user",
            operation: "audio_transcription",
            provider: "google",
            model: "gemini-2.5-flash",
            status: "success",
            input_audio_bytes: 700,
            input_seconds: 7,
            input_tokens_estimated: 140,
            output_tokens_estimated: 30,
            total_tokens_estimated: 170,
            estimated_cost: 0.0075,
            currency: "BRL",
            created_at: "2026-05-01T14:00:00.000Z",
          },
        ],
      },
    });
    app = created.app;
  });

  it("aggregates monthly usage metrics for professionals", async () => {
    const response = await request(app)
      .get("/api/ai/usage/summary")
      .set("x-user-id", "pro-user")
      .query({ month: "2026-04" });

    expect(response.status).toBe(200);
    expect(response.body?.period).toBe("2026-04");
    expect(response.body?.totals?.requests).toBe(2);
    expect(response.body?.totals?.success_count).toBe(1);
    expect(response.body?.totals?.failed_count).toBe(1);
    expect(response.body?.totals?.total_tokens_estimated).toBe(410);
    expect(response.body?.totals?.estimated_cost).toBeCloseTo(0.0168, 6);
    expect(Array.isArray(response.body?.by_model)).toBe(true);
    expect(Array.isArray(response.body?.by_day)).toBe(true);
    expect(Array.isArray(response.body?.recent)).toBe(true);
  });

  it("denies secretary role from reading AI usage summary", async () => {
    const response = await request(app)
      .get("/api/ai/usage/summary")
      .set("x-user-id", "sec-user")
      .query({ month: "2026-04" });

    expect(response.status).toBe(403);
  });
});
