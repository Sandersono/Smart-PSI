import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

type MockRow = Record<string, unknown>;
type MockDb = Record<string, MockRow[]>;

function cloneRow<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function pickColumns(row: MockRow, columns: string | null): MockRow {
  if (!columns || columns.trim() === "*" || columns.trim() === "") {
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
        const key = upsertConflictKey?.split(",")[0]?.trim() || null;
        for (const raw of incoming) {
          const row = cloneRow(raw || {});
          let existing: MockRow | undefined;
          if (key) {
            existing = tableRows.find((item) => item[key] === row[key]);
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
        getUserById: vi.fn(async (userId: string) => ({
          data: { user: { id: userId, email: `${userId}@example.com`, user_metadata: {} } },
          error: null,
        })),
        listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })),
      },
    },
  };

  return { client, db };
}

async function createTestApp(options: {
  env?: Record<string, string | undefined>;
  seed?: Partial<MockDb>;
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
    expect(String(response.body?.error || "")).toContain("Secretary cannot update clinical notes");
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

  it("creates financial record on RECEIVED and updates it on REFUNDED", async () => {
    const received = await request(app)
      .post("/api/asaas/webhook")
      .set("x-asaas-token", "asaas-secret-token")
      .send({
        event: "PAYMENT_RECEIVED",
        payment: {
          id: "ch_123",
          status: "RECEIVED",
          value: 199.9,
          paymentDate: "2026-02-21",
        },
      });

    expect(received.status).toBe(200);
    expect(db.financial_records.length).toBe(1);
    expect(db.financial_records[0]).toMatchObject({
      clinic_id: "clinic-1",
      patient_id: 21,
      type: "income",
      category: "Sessao Asaas",
      description: "Asaas charge ch_123",
      status: "paid",
      amount: 199.9,
    });
    expect(db.asaas_charges[0]?.status).toBe("RECEIVED");

    const refunded = await request(app)
      .post("/api/asaas/webhook")
      .set("x-asaas-token", "asaas-secret-token")
      .send({
        event: "PAYMENT_REFUNDED",
        payment: {
          id: "ch_123",
          status: "REFUNDED",
          value: 199.9,
          dueDate: "2026-02-20",
        },
      });

    expect(refunded.status).toBe(200);
    expect(db.financial_records.length).toBe(1);
    expect(db.financial_records[0]?.status).toBe("pending");
    expect(db.asaas_charges[0]?.status).toBe("REFUNDED");
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
});
