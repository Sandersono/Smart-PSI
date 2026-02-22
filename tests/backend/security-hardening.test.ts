import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

describe("backend hardening", () => {
  let app: Awaited<ReturnType<(typeof import("../../server"))["createApp"]>>;

  beforeAll(async () => {
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-key";
    process.env.NODE_ENV = "production";
    process.env.ALLOW_DEV_USER_BYPASS = "true";
    process.env.FEATURE_GOOGLE_ENABLED = "true";
    process.env.FEATURE_ASAAS_ENABLED = "true";
    process.env.GOOGLE_WEBHOOK_TOKEN = "";
    process.env.ASAAS_WEBHOOK_TOKEN = "";

    const { createApp } = await import("../../server");
    app = await createApp({ includeFrontend: false });
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
    const response = await request(app).post("/api/asaas/webhook").set("x-asaas-token", "anything").send({});
    expect(response.status).toBe(503);
    expect(String(response.body?.error || "")).toContain("not configured");
  });
});

describe("webhook token validation when configured", () => {
  let app: Awaited<ReturnType<(typeof import("../../server"))["createApp"]>>;

  beforeAll(async () => {
    vi.resetModules();
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-key";
    process.env.NODE_ENV = "production";
    process.env.ALLOW_DEV_USER_BYPASS = "false";
    process.env.FEATURE_GOOGLE_ENABLED = "true";
    process.env.FEATURE_ASAAS_ENABLED = "true";
    process.env.GOOGLE_WEBHOOK_TOKEN = "google-secret-token";
    process.env.ASAAS_WEBHOOK_TOKEN = "asaas-secret-token";

    const { createApp } = await import("../../server");
    app = await createApp({ includeFrontend: false });
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
