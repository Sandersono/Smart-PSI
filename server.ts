import dotenv from "dotenv";
import express, { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import * as Sentry from "@sentry/node";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

dotenv.config({ path: ".env.local" });
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;
const asaasApiKey = process.env.ASAAS_API_KEY;
const asaasBaseUrl = process.env.ASAAS_BASE_URL || "https://sandbox.asaas.com/api/v3";
const asaasWebhookToken = process.env.ASAAS_WEBHOOK_TOKEN || "";
const asaasDefaultSessionValue = Number(process.env.ASAAS_DEFAULT_SESSION_VALUE || "150");
const evolutionWebhookToken = process.env.EVOLUTION_WEBHOOK_TOKEN || "";
const appUrl = process.env.APP_URL || "http://localhost:3000";
const adminUrl = process.env.ADMIN_URL || "";
const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI || `${appUrl}/api/integrations/google/callback`;
const googleWebhookToken = process.env.GOOGLE_WEBHOOK_TOKEN || "";
const integrationsSecret = process.env.INTEGRATIONS_ENCRYPTION_KEY || supabaseServiceRoleKey;
const internalJobToken = process.env.INTERNAL_JOB_TOKEN || "";
const sentryDsn = process.env.SENTRY_DSN || "";
const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";
const allowDevUserBypass =
  !isProduction && String(process.env.ALLOW_DEV_USER_BYPASS || "").toLowerCase() === "true";
const featureGoogleEnabled =
  process.env.FEATURE_GOOGLE_ENABLED === undefined
    ? !isProduction
    : String(process.env.FEATURE_GOOGLE_ENABLED).toLowerCase() === "true";
const featureAsaasEnabled =
  process.env.FEATURE_ASAAS_ENABLED === undefined
    ? !isProduction
    : String(process.env.FEATURE_ASAAS_ENABLED).toLowerCase() === "true";
const corsAllowedOrigins = String(process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || "900000");
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || "300");
const frontendSupabaseUrl = process.env.VITE_SUPABASE_URL || "";
const aiModelName = process.env.AI_MODEL_NAME || "gemini-2.5-flash";
const aiTokenCostPerMillion = Number(process.env.AI_TOKEN_COST_PER_MILLION || "0");
const aiAudioCostPerMinute = Number(process.env.AI_AUDIO_COST_PER_MINUTE || "0");
const aiAudioTokensPerMinute = Number(process.env.AI_AUDIO_TOKENS_PER_MINUTE || "900");
const aiAudioAvgBitrateKbps = Number(process.env.AI_AUDIO_AVG_BITRATE_KBPS || "64");
const aiCostCurrency = process.env.AI_COST_CURRENCY || "BRL";

function extractHost(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    if (raw.includes("://")) {
      return new URL(raw).hostname.toLowerCase();
    }
    return new URL(`https://${raw}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const superadminAllowedHosts = Array.from(
  new Set(
    [
      ...String(process.env.SUPERADMIN_ALLOWED_HOSTS || "")
        .split(",")
        .map((item) => extractHost(item))
        .filter((item): item is string => Boolean(item)),
      extractHost(adminUrl),
    ].filter((item): item is string => Boolean(item))
  )
);
const superadminBootstrapUserIds = Array.from(
  new Set(
    String(process.env.SUPERADMIN_BOOTSTRAP_USER_IDS || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  )
);

const missingServerEnv = [
  ["SUPABASE_URL", supabaseUrl],
  ["SUPABASE_SERVICE_ROLE_KEY", supabaseServiceRoleKey],
].filter(([, value]) => !value);

if (missingServerEnv.length > 0) {
  const envFiles = [".env.local", ".env"].filter((file) =>
    fs.existsSync(path.resolve(process.cwd(), file))
  );
  throw new Error(
    `Missing required server env vars: ${missingServerEnv
      .map(([name]) => name)
      .join(", ")}. Env files found: ${envFiles.length > 0 ? envFiles.join(", ") : "none"}. Create .env.local or .env in project root.`
  );
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false },
});
const gemini = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: nodeEnv,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1"),
  });
}

const PORT = Number(process.env.PORT || 3000);

type UserRole = "admin" | "professional" | "secretary";
type TenantStatus = "trialing" | "active" | "past_due" | "suspended" | "cancelled";
type BillingProvider = "manual" | "asaas";
type UserContext = {
  userId: string;
  clinicId: string;
  role: UserRole;
};
type SuperadminContext = {
  userId: string;
};
type AppointmentStatus = "scheduled" | "completed" | "cancelled";
type SessionType = "individual" | "couple";
type SessionMode = "in_person" | "online";
type RecurrenceFrequency = "weekly" | "biweekly" | "monthly";
type ApplyScope = "single" | "following" | "all";
type BillingMode = "session" | "monthly";
type NoteSource = "audio" | "quick" | "manual";
type GoogleReminderPreset = "light" | "standard" | "intense";
type AiUsageStatus = "success" | "failed";
type EvolutionConnectionStatus = "connected" | "disconnected" | "error";
type InboxThreadStatus = "open" | "pending" | "resolved" | "blocked";
type InboxMessageDirection = "inbound" | "outbound" | "system";

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.header("authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data.user) {
        return data.user.id;
      }
      console.warn("Failed to validate bearer token", error?.message || "unknown error");
    }
  }

  if (allowDevUserBypass) {
    return req.header("x-user-id") || process.env.SUPABASE_DEV_USER_ID || null;
  }

  return null;
}

let warnedMissingTenantSubscriptionSchema = false;
let warnedMissingSuperadminSchema = false;
let warnedMissingEvolutionSchema = false;

async function bootstrapSuperadminsFromEnv() {
  if (superadminBootstrapUserIds.length === 0) return;
  try {
    const nowIso = new Date().toISOString();
    const payload = superadminBootstrapUserIds.map((userId) => ({
      user_id: userId,
      active: true,
      updated_at: nowIso,
    }));
    const { error } = await supabase.from("platform_superadmins").upsert(payload, {
      onConflict: "user_id",
    });
    if (error) throw error;
  } catch (error) {
    if (isMissingRelationError(error)) {
      if (!warnedMissingSuperadminSchema) {
        warnedMissingSuperadminSchema = true;
        console.warn(
          "platform_superadmins table is missing. Run migration 20260225_007_superadmin_platform_foundation.sql."
        );
      }
      return;
    }
    throw error;
  }
}

async function assertUserIsSuperadmin(userId: string) {
  const { data, error } = await supabase
    .from("platform_superadmins")
    .select("user_id, active")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) {
      throw new HttpError(
        503,
        "Database schema is outdated. Run migration 20260225_007_superadmin_platform_foundation.sql."
      );
    }
    throw error;
  }

  if (!data || data.active === false) {
    throw new HttpError(403, "Usuario sem permissao de superadmin.");
  }
}

function assertSuperadminHost(req: Request) {
  if (!isProduction) return;
  if (superadminAllowedHosts.length === 0) return;
  const requestHost = String(req.hostname || "").toLowerCase();
  if (!superadminAllowedHosts.includes(requestHost)) {
    throw new HttpError(
      403,
      `Superadmin disponivel apenas em: ${superadminAllowedHosts.join(", ")}.`
    );
  }
}

async function requireSuperadminContext(req: Request, res: Response): Promise<SuperadminContext | null> {
  try {
    const userId = await resolveUserId(req);
    if (!userId) {
      res.status(401).json({
        error: allowDevUserBypass
          ? "Missing user context. Set SUPABASE_DEV_USER_ID (dev) or send Bearer token."
          : "Missing user context. Send a valid Bearer token.",
      });
      return null;
    }

    assertSuperadminHost(req);
    await assertUserIsSuperadmin(userId);
    return { userId };
  } catch (error) {
    handleRouteError(res, error, "requireSuperadminContext");
    return null;
  }
}

type TenantAccessState = {
  status: TenantStatus | null;
  blocked: boolean;
  reason: string | null;
};

async function resolveClinicAccessState(clinicId: string): Promise<TenantAccessState> {
  try {
    const { data, error } = await supabase
      .from("tenant_subscriptions")
      .select("status, payment_grace_until, suspended_reason")
      .eq("clinic_id", clinicId)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return { status: null, blocked: false, reason: null };
    }

    const status = parseTenantStatus(data.status);
    const suspendedReason = toNullableString(data.suspended_reason);
    if (!status || status === "active" || status === "trialing") {
      return { status, blocked: false, reason: null };
    }

    if (status === "past_due") {
      const graceUntil = toNullableString(data.payment_grace_until);
      if (graceUntil) {
        const graceDate = new Date(graceUntil);
        if (!Number.isNaN(graceDate.getTime()) && graceDate.getTime() >= Date.now()) {
          return { status, blocked: false, reason: null };
        }
      }
      return {
        status,
        blocked: true,
        reason: "Acesso bloqueado por pendencia financeira. Regularize o pagamento para liberar o uso.",
      };
    }

    if (status === "suspended") {
      return {
        status,
        blocked: true,
        reason:
          suspendedReason ||
          "Acesso bloqueado administrativamente. Contate o suporte para reativacao.",
      };
    }

    return {
      status,
      blocked: true,
      reason:
        suspendedReason || "Assinatura cancelada. Reative um plano para retomar o acesso ao sistema.",
    };
  } catch (error) {
    if (isMissingRelationError(error)) {
      if (!warnedMissingTenantSubscriptionSchema) {
        warnedMissingTenantSubscriptionSchema = true;
        console.warn(
          "tenant_subscriptions table is missing. Run migration 20260225_007_superadmin_platform_foundation.sql."
        );
      }
      return { status: null, blocked: false, reason: null };
    }
    throw error;
  }
}

async function assertClinicAccessAllowed(clinicId: string) {
  const state = await resolveClinicAccessState(clinicId);
  if (!state.blocked) return;
  if (state.status === "past_due") {
    throw new HttpError(402, state.reason || "Pagamento pendente.");
  }
  throw new HttpError(403, state.reason || "Acesso bloqueado.");
}

async function ensureClinicMembership(userId: string, preferredClinicId?: string | null) {
  const { data: memberships, error: membershipsError } = await supabase
    .from("clinic_members")
    .select("id, clinic_id, role, active, created_at")
    .eq("user_id", userId)
    .eq("active", true)
    .order("created_at", { ascending: true });

  if (membershipsError) {
    const code = (membershipsError as { code?: string }).code;
    if (code === "42P01" || code === "PGRST205") {
      throw new HttpError(
        503,
        "Database schema is outdated. Run migrations 20260221_002_clinic_rbac_agenda_asaas.sql, 20260221_003_google_agenda_notes_source.sql, 20260221_004_financial_monthly_asaas_settings.sql, 20260222_005_ai_usage_meter.sql, 20260224_006_patient_linkage_guardrails.sql and 20260225_007_superadmin_platform_foundation.sql."
      );
    }
    throw membershipsError;
  }

  const activeMemberships = memberships ?? [];
  if (activeMemberships.length === 0) {
    const { data: clinicData, error: clinicError } = await supabase
      .from("clinics")
      .insert({
        name: `Clinica ${userId.slice(0, 8)}`,
        owner_user_id: userId,
      })
      .select("id")
      .single();

    if (clinicError) throw clinicError;

    const { error: memberError } = await supabase.from("clinic_members").insert({
      clinic_id: clinicData.id,
      user_id: userId,
      role: "admin",
      active: true,
    });
    if (memberError) throw memberError;

    const { error: tenantError } = await supabase.from("tenant_subscriptions").upsert(
      {
        clinic_id: clinicData.id,
        plan_code: "starter",
        status: "active",
        billing_provider: "manual",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clinic_id" }
    );
    if (tenantError && !isMissingRelationError(tenantError)) {
      throw tenantError;
    }

    return { clinicId: String(clinicData.id), role: "admin" as UserRole };
  }

  if (preferredClinicId) {
    const selected = activeMemberships.find((item) => item.clinic_id === preferredClinicId);
    if (selected) {
      return {
        clinicId: String(selected.clinic_id),
        role: parseRole(selected.role) || "professional",
      };
    }
  }

  const first = activeMemberships[0];
  return {
    clinicId: String(first.clinic_id),
    role: parseRole(first.role) || "professional",
  };
}

async function requireUserContext(
  req: Request,
  res: Response,
  roles?: UserRole[]
): Promise<UserContext | null> {
  try {
    const userId = await resolveUserId(req);
    if (!userId) {
      res.status(401).json({
        error: allowDevUserBypass
          ? "Missing user context. Set SUPABASE_DEV_USER_ID (dev) or send Bearer token."
          : "Missing user context. Send a valid Bearer token.",
      });
      return null;
    }

    const preferredClinicId = req.header("x-clinic-id");
    const membership = await ensureClinicMembership(userId, preferredClinicId);
    const context: UserContext = {
      userId,
      clinicId: membership.clinicId,
      role: membership.role,
    };

    await assertClinicAccessAllowed(context.clinicId);

    if (roles && !roles.includes(context.role)) {
      res.status(403).json({ error: "Insufficient permissions for this action." });
      return null;
    }

    return context;
  } catch (error) {
    handleRouteError(res, error, "requireUserContext");
    return null;
  }
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDateTimeOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const normalized = value.includes("T") ? value : `${value}T00:00:00.000Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function parseOptionalDateTimeInput(
  value: unknown,
  fieldName: string
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = toDateTimeOrNull(value);
  if (!parsed) {
    throw new HttpError(400, `${fieldName} must be an ISO datetime or YYYY-MM-DD.`);
  }
  return parsed;
}

function toDateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function toBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const raw = toNullableString(value);
  if (!raw) return false;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
}

function toTimestampIso(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    const parsed = new Date(millis);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (typeof value === "string" && value.trim() !== "") {
    const maybeNumber = Number(value);
    if (Number.isFinite(maybeNumber)) {
      return toTimestampIso(maybeNumber);
    }
    return toDateTimeOrNull(value);
  }
  return null;
}

function ensureHttpUrl(value: unknown, fieldName: string) {
  const raw = toNullableString(value);
  if (!raw) {
    throw new HttpError(400, `${fieldName} e obrigatorio.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new HttpError(400, `${fieldName} invalido.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(400, `${fieldName} deve iniciar com http:// ou https://.`);
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/+$/, "");
}

function normalizeInboxLabels(value: unknown): string[] {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
    ? value.split(",")
    : [];
  const normalized = rawItems
    .map((item) => toNullableString(item))
    .filter((item): item is string => Boolean(item))
    .map((item) =>
      item
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9._-]+/g, "")
    )
    .filter((item) => item.length > 0)
    .slice(0, 30);
  return Array.from(new Set(normalized));
}

function parseLabelsJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return normalizeInboxLabels(value);
}

function toPhoneFromThreadId(value: unknown): string | null {
  const raw = toNullableString(value);
  if (!raw) return null;
  const beforeAt = raw.split("@")[0];
  const digits = beforeAt.replace(/\D+/g, "");
  return digits.length > 0 ? digits : null;
}

function addMinutesToIso(iso: string, minutes: number) {
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function isValidDateOrder(startIso: string, endIso: string) {
  return new Date(endIso).getTime() > new Date(startIso).getTime();
}

function normalizeAppointmentStatus(value: unknown): AppointmentStatus | null {
  const raw = toNullableString(value) || "scheduled";
  if (raw === "scheduled" || raw === "completed" || raw === "cancelled") return raw;
  return null;
}

function normalizeSessionType(value: unknown): SessionType | null {
  const raw = toNullableString(value) || "individual";
  if (raw === "individual" || raw === "couple") return raw;
  return null;
}

function normalizeSessionMode(value: unknown): SessionMode | null {
  const raw = toNullableString(value) || "in_person";
  if (raw === "in_person" || raw === "online") return raw;
  return null;
}

function normalizeApplyScope(value: unknown): ApplyScope {
  const raw = toNullableString(value) || "single";
  if (raw === "following" || raw === "all") return raw;
  return "single";
}

function normalizeRecurrenceFrequency(value: unknown): RecurrenceFrequency | null {
  const raw = toNullableString(value);
  if (raw === "weekly" || raw === "biweekly" || raw === "monthly") return raw;
  return null;
}

function normalizeBillingMode(value: unknown): BillingMode | null {
  const raw = toNullableString(value);
  if (raw === "session" || raw === "monthly") return raw;
  return null;
}

function normalizeNoteSource(value: unknown): NoteSource {
  const raw = toNullableString(value);
  if (raw === "audio" || raw === "quick") return raw;
  return "manual";
}

function normalizeGoogleReminderPreset(value: unknown): GoogleReminderPreset {
  const raw = toNullableString(value);
  if (raw === "light" || raw === "intense") return raw;
  return "standard";
}

function parseRole(value: unknown): UserRole | null {
  const raw = toNullableString(value);
  if (raw === "admin" || raw === "professional" || raw === "secretary") return raw;
  return null;
}

function parseTenantStatus(value: unknown): TenantStatus | null {
  const raw = toNullableString(value);
  if (
    raw === "trialing" ||
    raw === "active" ||
    raw === "past_due" ||
    raw === "suspended" ||
    raw === "cancelled"
  ) {
    return raw;
  }
  return null;
}

function parseBillingProvider(value: unknown): BillingProvider | null {
  const raw = toNullableString(value);
  if (raw === "manual" || raw === "asaas") return raw;
  return null;
}

function parseEvolutionConnectionStatus(value: unknown): EvolutionConnectionStatus | null {
  const raw = toNullableString(value);
  if (raw === "connected" || raw === "disconnected" || raw === "error") return raw;
  return null;
}

function parseInboxThreadStatus(value: unknown): InboxThreadStatus | null {
  const raw = toNullableString(value);
  if (raw === "open" || raw === "pending" || raw === "resolved" || raw === "blocked") return raw;
  return null;
}

function parseInboxMessageDirection(value: unknown): InboxMessageDirection | null {
  const raw = toNullableString(value);
  if (raw === "inbound" || raw === "outbound" || raw === "system") return raw;
  return null;
}

function endOfDayUtcIso(dateOnly: string) {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999)).toISOString();
}

function nextDateByFrequency(date: Date, frequency: RecurrenceFrequency) {
  const next = new Date(date);
  if (frequency === "weekly") {
    next.setDate(next.getDate() + 7);
  } else if (frequency === "biweekly") {
    next.setDate(next.getDate() + 14);
  } else {
    next.setMonth(next.getMonth() + 1);
  }
  return next;
}

function generateRecurrenceDates(
  startIso: string,
  frequency: RecurrenceFrequency,
  untilDate: string
) {
  const untilIso = endOfDayUtcIso(untilDate);
  const until = new Date(untilIso);
  const start = new Date(startIso);

  if (until.getTime() < start.getTime()) {
    throw new HttpError(400, "recurrence.until_date must be on/after start_time");
  }

  const dates: string[] = [];
  let current = new Date(start);
  while (current.getTime() <= until.getTime()) {
    dates.push(current.toISOString());
    current = nextDateByFrequency(current, frequency);
  }
  return dates;
}

function isAsaasConfigured() {
  return featureAsaasEnabled && Boolean(asaasApiKey);
}

function isGoogleConfigured() {
  return featureGoogleEnabled && Boolean(googleClientId && googleClientSecret && googleRedirectUri);
}

function buildReminderPresetTimeline(preset: GoogleReminderPreset) {
  if (preset === "light") {
    return [{ days: 1, channel: "email" }];
  }
  if (preset === "intense") {
    return [
      { days: 3, channel: "email" },
      { days: 1, channel: "email" },
      { hours: 2, channel: "sms" },
    ];
  }
  return [
    { days: 2, channel: "email" },
    { hours: 24, channel: "email" },
  ];
}

function defaultClinicBillingSettings() {
  return {
    default_billing_mode: "session" as BillingMode,
    monthly_generation_day: 5,
    timezone: "America/Sao_Paulo",
    auto_generate_monthly: true,
  };
}

function defaultClinicAsaasSettings() {
  const preset: GoogleReminderPreset = "standard";
  return {
    reminder_preset: preset,
    reminder_channels: ["email", "sms"],
    reminder_timeline: buildReminderPresetTimeline(preset),
    default_due_days: 2,
    late_fee_percent: 2,
    interest_percent: 1,
  };
}

const INTEGRATION_ENCRYPTION_KEY = crypto
  .createHash("sha256")
  .update(String(integrationsSecret || "smartpsi"))
  .digest();

function encryptSecret(raw: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", INTEGRATION_ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString(
    "base64url"
  )}`;
}

function decryptSecret(encoded: string) {
  const [ivRaw, tagRaw, dataRaw] = String(encoded || "").split(".");
  if (!ivRaw || !tagRaw || !dataRaw) {
    throw new HttpError(500, "Malformed encrypted secret payload");
  }
  const iv = Buffer.from(ivRaw, "base64url");
  const tag = Buffer.from(tagRaw, "base64url");
  const data = Buffer.from(dataRaw, "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", INTEGRATION_ENCRYPTION_KEY, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

function signStatePayload(payload: Record<string, unknown>) {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto
    .createHmac("sha256", INTEGRATION_ENCRYPTION_KEY)
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function verifySignedState(stateRaw: string) {
  const [encodedPayload, signature] = String(stateRaw || "").split(".");
  if (!encodedPayload || !signature) {
    throw new HttpError(400, "Invalid oauth state");
  }
  const expected = crypto
    .createHmac("sha256", INTEGRATION_ENCRYPTION_KEY)
    .update(encodedPayload)
    .digest("base64url");
  if (expected !== signature) {
    throw new HttpError(400, "Invalid oauth state signature");
  }
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  return payload as { clinicId?: string; userId?: string; ts?: number };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toOriginOrNull(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function toRealtimeOriginOrNull(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:") {
      return `wss://${parsed.host}`;
    }
    if (parsed.protocol === "http:") {
      return `ws://${parsed.host}`;
    }
    return null;
  } catch {
    return null;
  }
}

function buildConnectSrc() {
  const origins = new Set<string>(["'self'"]);
  const sentryOrigin = toOriginOrNull(sentryDsn || null);
  const candidates = [supabaseUrl, frontendSupabaseUrl, sentryOrigin];

  candidates.forEach((candidate) => {
    const origin = toOriginOrNull(candidate);
    const realtimeOrigin = toRealtimeOriginOrNull(candidate);
    if (origin) {
      origins.add(origin);
    }
    if (realtimeOrigin) {
      origins.add(realtimeOrigin);
    }
  });

  return Array.from(origins);
}

function normalizeFinancialStatus(value: unknown) {
  const raw = toNullableString(value) || "pending";
  return ["paid", "pending"].includes(raw) ? raw : null;
}

type AiNotePreferences = {
  tone: "clinical" | "empathetic";
  length: "short" | "medium" | "long";
  language: "pt-BR";
};

function normalizeNotePreferences(value: unknown): AiNotePreferences {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const tone = input.tone === "empathetic" ? "empathetic" : "clinical";
  const length =
    input.length === "short" || input.length === "long" ? input.length : "medium";
  return {
    tone,
    length,
    language: "pt-BR",
  };
}

function noteStyleInstructions(preferences: AiNotePreferences) {
  const toneInstruction =
    preferences.tone === "empathetic"
      ? "Use linguagem acolhedora, mantendo clareza tecnica."
      : "Use linguagem objetiva, clinica e direta.";

  const lengthInstruction =
    preferences.length === "short"
      ? "Mantenha cada campo curto (1 a 2 frases)."
      : preferences.length === "long"
      ? "Forneca mais contexto (3 a 5 frases por campo), sem inventar fatos."
      : "Mantenha tamanho medio (2 a 3 frases por campo).";

  return `${toneInstruction} ${lengthInstruction} Responda em Portugues do Brasil.`;
}

function validateFinalNotePayload(
  patientId: number | null,
  complaint: string | null,
  intervention: string | null,
  nextFocus: string | null
) {
  return Boolean(patientId && complaint && intervention && nextFocus);
}

type AiUsageMetrics = {
  model: string;
  input_audio_bytes: number;
  input_seconds: number;
  input_tokens_estimated: number;
  output_tokens_estimated: number;
  total_tokens_estimated: number;
  estimated_cost: number;
  currency: string;
  prompt_chars: number;
  output_chars: number;
};

function normalizeFiniteNumber(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function roundNumber(value: number, digits = 6) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function estimateTokensFromChars(chars: number) {
  const normalized = Math.max(0, Math.trunc(chars));
  return Math.ceil(normalized / 4);
}

function estimateAudioDurationSeconds(audioBytes: number) {
  const safeBytes = Math.max(0, Math.trunc(audioBytes));
  const bitrateKbps = normalizeFiniteNumber(aiAudioAvgBitrateKbps, 64);
  if (safeBytes <= 0 || bitrateKbps <= 0) return 0;
  const seconds = (safeBytes * 8) / (bitrateKbps * 1000);
  return roundNumber(seconds, 2);
}

function estimateAudioInputTokens(audioSeconds: number) {
  const tokensPerMinute = normalizeFiniteNumber(aiAudioTokensPerMinute, 900);
  if (tokensPerMinute <= 0 || audioSeconds <= 0) return 0;
  return Math.max(0, Math.round((audioSeconds / 60) * tokensPerMinute));
}

function estimateAiCost(totalTokens: number, audioSeconds: number) {
  const tokenCostPerMillion = normalizeFiniteNumber(aiTokenCostPerMillion, 0);
  const audioCostPerMinute = normalizeFiniteNumber(aiAudioCostPerMinute, 0);
  const tokenCost =
    tokenCostPerMillion > 0 ? (Math.max(0, totalTokens) / 1_000_000) * tokenCostPerMillion : 0;
  const audioCost = audioCostPerMinute > 0 ? (Math.max(0, audioSeconds) / 60) * audioCostPerMinute : 0;
  return roundNumber(tokenCost + audioCost, 6);
}

function buildAiUsageMetrics(params: {
  model: string;
  audioBytes: number;
  promptChars: number;
  outputChars: number;
}): AiUsageMetrics {
  const audioSeconds = estimateAudioDurationSeconds(params.audioBytes);
  const inputTokens = estimateAudioInputTokens(audioSeconds) + estimateTokensFromChars(params.promptChars);
  const outputTokens = estimateTokensFromChars(params.outputChars);
  const totalTokens = inputTokens + outputTokens;
  const estimatedCost = estimateAiCost(totalTokens, audioSeconds);

  return {
    model: params.model,
    input_audio_bytes: Math.max(0, Math.trunc(params.audioBytes)),
    input_seconds: audioSeconds,
    input_tokens_estimated: inputTokens,
    output_tokens_estimated: outputTokens,
    total_tokens_estimated: totalTokens,
    estimated_cost: estimatedCost,
    currency: aiCostCurrency,
    prompt_chars: Math.max(0, Math.trunc(params.promptChars)),
    output_chars: Math.max(0, Math.trunc(params.outputChars)),
  };
}

function errorCodeOf(error: unknown) {
  return (
    (error as { code?: string } | null | undefined)?.code ||
    (error as { error?: { code?: string } } | null | undefined)?.error?.code ||
    ""
  );
}

function isMissingRelationError(error: unknown) {
  const code = errorCodeOf(error);
  return code === "42P01" || code === "PGRST205";
}

type RegisterAiUsageEventPayload = {
  context: UserContext;
  patientId: number | null;
  noteId?: number | null;
  status: AiUsageStatus;
  metrics: AiUsageMetrics;
  requestId?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
};

async function registerAiUsageEvent(payload: RegisterAiUsageEventPayload) {
  try {
    const { error } = await supabase.from("ai_usage_events").insert({
      clinic_id: payload.context.clinicId,
      user_id: payload.context.userId,
      patient_id: payload.patientId,
      note_id: payload.noteId ?? null,
      operation: "audio_transcription",
      provider: "google",
      model: payload.metrics.model,
      status: payload.status,
      input_audio_bytes: payload.metrics.input_audio_bytes,
      input_seconds: payload.metrics.input_seconds,
      input_tokens_estimated: payload.metrics.input_tokens_estimated,
      output_tokens_estimated: payload.metrics.output_tokens_estimated,
      total_tokens_estimated: payload.metrics.total_tokens_estimated,
      estimated_cost: payload.metrics.estimated_cost,
      currency: payload.metrics.currency,
      error_message: toNullableString(payload.errorMessage) || null,
      request_id: toNullableString(payload.requestId) || null,
      metadata: {
        prompt_chars: payload.metrics.prompt_chars,
        output_chars: payload.metrics.output_chars,
        ...(payload.metadata || {}),
      },
    });

    if (error) {
      if (isMissingRelationError(error)) {
        console.warn(
          "ai_usage_events table is missing. Run migration 20260222_005_ai_usage_meter.sql."
        );
        return;
      }
      throw error;
    }
  } catch (error) {
    if (isMissingRelationError(error)) {
      console.warn("AI usage meter schema not found. Skipping usage event registration.");
      return;
    }
    console.error("[registerAiUsageEvent]", error);
  }
}

type ProcessAudioResult = {
  note: {
    complaint: string;
    intervention: string;
    next_focus: string;
  };
  metrics: AiUsageMetrics;
};

async function processAudioToNote(
  audioBase64: string,
  mimeType: string,
  preferences: AiNotePreferences,
  audioBytes: number
): Promise<ProcessAudioResult> {
  if (!gemini) {
    throw new Error("GEMINI_API_KEY is not configured on server.");
  }

  const styleInstructions = noteStyleInstructions(preferences);
  const prompt = `
    Voce e um assistente especializado em transcricao e sintese de sessoes de psicoterapia.
    Analise o audio da sessao e gere uma nota clinica estruturada com os seguintes campos:
    1. Queixa: O que o paciente trouxe como demanda principal.
    2. Intervencao: O que o terapeuta fez ou pontuou.
    3. Proximo Foco: O que deve ser trabalhado na proxima sessao.

    ${styleInstructions}

    Se nao conseguir identificar algum campo, escreva "Nao identificado - revisar".
    Responda estritamente em formato JSON.
  `;

  const response = await gemini.models.generateContent({
    model: aiModelName,
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType,
              data: audioBase64,
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          complaint: { type: Type.STRING },
          intervention: { type: Type.STRING },
          next_focus: { type: Type.STRING },
        },
        required: ["complaint", "intervention", "next_focus"],
      },
    },
  });

  const responseText = String((response as { text?: string }).text || "{}");
  const parsed = JSON.parse(responseText || "{}");
  const note = {
    complaint: String(parsed.complaint || "Nao identificado - revisar"),
    intervention: String(parsed.intervention || "Nao identificado - revisar"),
    next_focus: String(parsed.next_focus || "Nao identificado - revisar"),
  };
  const metrics = buildAiUsageMetrics({
    model: aiModelName,
    audioBytes,
    promptChars: prompt.length,
    outputChars: responseText.length,
  });

  return { note, metrics };
}

function dayRangeUtc(dayOffset: number) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() + dayOffset);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString(), date: start };
}

function handleRouteError(res: Response, error: unknown, context: string) {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (sentryDsn) {
    Sentry.captureException(
      error instanceof Error ? error : new Error(`Unhandled error in ${context}: ${String(error)}`)
    );
  }
  console.error(
    JSON.stringify({
      level: "error",
      event: "route_error",
      context,
      message: error instanceof Error ? error.message : String(error),
    })
  );
  res.status(500).json({ error: "Internal server error" });
}

function toUuidOrNull(value: unknown) {
  const raw = toNullableString(value);
  if (!raw) return null;
  const match = raw.match(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
  return match ? raw : null;
}

type PlatformAuditPayload = {
  actorUserId: string | null;
  actorType: "superadmin" | "system";
  action: string;
  targetType: string;
  targetId?: string | null;
  clinicId?: string | null;
  metadata?: Record<string, unknown>;
};

async function registerPlatformAuditLog(payload: PlatformAuditPayload) {
  try {
    const { error } = await supabase.from("platform_audit_logs").insert({
      actor_user_id: payload.actorUserId,
      actor_type: payload.actorType,
      action: payload.action,
      target_type: payload.targetType,
      target_id: payload.targetId || null,
      clinic_id: payload.clinicId || null,
      metadata: payload.metadata || {},
    });
    if (error) throw error;
  } catch (error) {
    if (isMissingRelationError(error)) {
      if (!warnedMissingSuperadminSchema) {
        warnedMissingSuperadminSchema = true;
        console.warn(
          "platform_audit_logs table is missing. Run migration 20260225_007_superadmin_platform_foundation.sql."
        );
      }
      return;
    }
    console.error("[registerPlatformAuditLog]", error);
  }
}

type EvolutionConnectionRow = {
  clinic_id: string;
  api_base_url: string;
  instance_name: string;
  api_token_encrypted: string;
  webhook_secret: string | null;
  status: EvolutionConnectionStatus | null;
  last_error: string | null;
  last_seen_at: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

type InboxThreadRow = {
  id: number;
  clinic_id: string;
  channel: string | null;
  external_thread_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  status: InboxThreadStatus | null;
  assigned_user_id: string | null;
  labels: unknown;
  unread_count: number | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

type InboxMessageRow = {
  id: number;
  clinic_id: string;
  thread_id: number;
  direction: InboxMessageDirection | null;
  message_type: string | null;
  content: string | null;
  external_message_id: string | null;
  sender_name: string | null;
  sender_phone: string | null;
  sent_by_user_id: string | null;
  sent_at: string | null;
  status: string | null;
  payload: Record<string, unknown> | null;
  created_at: string | null;
};

function throwIfEvolutionSchemaMissing(error: unknown) {
  if (isMissingRelationError(error)) {
    if (!warnedMissingEvolutionSchema) {
      warnedMissingEvolutionSchema = true;
      console.warn(
        "Evolution/inbox schema is missing. Run migration 20260225_008_evolution_inbox_core.sql."
      );
    }
    throw new HttpError(
      503,
      "Database schema is outdated. Run migration 20260225_008_evolution_inbox_core.sql."
    );
  }
}

function evolutionConnectionToResponse(connection: Partial<EvolutionConnectionRow> | null) {
  if (!connection) {
    return {
      configured: false,
      connected: false,
      connection: null,
    };
  }
  return {
    configured: true,
    connected: parseEvolutionConnectionStatus(connection.status) === "connected",
    connection: {
      clinic_id: String(connection.clinic_id || ""),
      api_base_url: toNullableString(connection.api_base_url),
      instance_name: toNullableString(connection.instance_name),
      webhook_secret_configured: Boolean(toNullableString(connection.webhook_secret)),
      status: parseEvolutionConnectionStatus(connection.status) || "disconnected",
      last_error: toNullableString(connection.last_error),
      last_seen_at: toNullableString(connection.last_seen_at),
      updated_at: toNullableString(connection.updated_at),
    },
  };
}

function inboxThreadToResponse(row: Partial<InboxThreadRow>) {
  return {
    id: Number(row.id || 0),
    clinic_id: String(row.clinic_id || ""),
    channel: toNullableString(row.channel) || "whatsapp",
    external_thread_id: toNullableString(row.external_thread_id),
    contact_name: toNullableString(row.contact_name),
    contact_phone: toNullableString(row.contact_phone),
    status: parseInboxThreadStatus(row.status) || "open",
    assigned_user_id: toNullableString(row.assigned_user_id),
    labels: parseLabelsJson(row.labels),
    unread_count: Math.max(0, Number(row.unread_count || 0)),
    last_message_preview: toNullableString(row.last_message_preview),
    last_message_at: toNullableString(row.last_message_at),
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    created_at: toNullableString(row.created_at),
    updated_at: toNullableString(row.updated_at),
  };
}

function inboxMessageToResponse(row: Partial<InboxMessageRow>) {
  return {
    id: Number(row.id || 0),
    clinic_id: String(row.clinic_id || ""),
    thread_id: Number(row.thread_id || 0),
    direction: parseInboxMessageDirection(row.direction) || "inbound",
    message_type: toNullableString(row.message_type) || "text",
    content: toNullableString(row.content),
    external_message_id: toNullableString(row.external_message_id),
    sender_name: toNullableString(row.sender_name),
    sender_phone: toNullableString(row.sender_phone),
    sent_by_user_id: toNullableString(row.sent_by_user_id),
    sent_at: toNullableString(row.sent_at),
    status: toNullableString(row.status) || "received",
    payload: row.payload && typeof row.payload === "object" ? row.payload : {},
    created_at: toNullableString(row.created_at),
  };
}

async function getEvolutionConnection(clinicId: string) {
  const { data, error } = await supabase
    .from("clinic_evolution_connections")
    .select(
      "clinic_id, api_base_url, instance_name, api_token_encrypted, webhook_secret, status, last_error, last_seen_at, metadata, updated_at"
    )
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (error) {
    throwIfEvolutionSchemaMissing(error);
    throw error;
  }
  return (data as EvolutionConnectionRow | null) || null;
}

async function assertUserBelongsClinic(clinicId: string, userId: string) {
  const { data, error } = await supabase
    .from("clinic_members")
    .select("id, role, active")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new HttpError(400, "Usuario informado nao pertence a clinica.");
  }
}

async function evolutionRequest(
  connection: EvolutionConnectionRow,
  pathname: string,
  init: RequestInit = {}
) {
  const baseUrl = ensureHttpUrl(connection.api_base_url, "api_base_url");
  let token = "";
  try {
    token = decryptSecret(connection.api_token_encrypted);
  } catch (error) {
    throw new HttpError(500, `Falha ao descriptografar token Evolution: ${String(error)}`);
  }
  if (!token) {
    throw new HttpError(409, "Token Evolution nao configurado.");
  }

  const headers = new Headers(init.headers ?? {});
  headers.set("accept", "application/json");
  headers.set("apikey", token);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers,
  });
  const rawText = await response.text();
  let payload: Record<string, unknown> | null = null;
  try {
    payload = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const payloadMessage = toNullableString((payload as Record<string, unknown> | null)?.message);
    const payloadError =
      payload && typeof payload.error === "string" ? toNullableString(payload.error) : null;
    const message =
      payloadMessage ||
      payloadError ||
      rawText ||
      "Falha na requisicao Evolution.";
    throw new HttpError(response.status, message);
  }

  return payload || { raw: rawText };
}

async function markEvolutionConnectionHeartbeat(clinicId: string, patch?: Record<string, unknown>) {
  const { error } = await supabase
    .from("clinic_evolution_connections")
    .update({
      status: "connected",
      last_error: null,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(patch || {}),
    })
    .eq("clinic_id", clinicId);
  if (error) {
    throwIfEvolutionSchemaMissing(error);
    throw error;
  }
}

type ParsedEvolutionWebhookMessage = {
  direction: InboxMessageDirection;
  eventName: string;
  externalThreadId: string | null;
  externalMessageId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  content: string | null;
  sentAt: string;
  payload: Record<string, unknown>;
};

function parseEvolutionWebhookMessage(payload: Record<string, unknown>): ParsedEvolutionWebhookMessage {
  const data = asRecord(payload.data);
  const key = asRecord(data.key);
  const message = asRecord(data.message);
  const extendedText = asRecord(message.extendedTextMessage);
  const messageContext = asRecord(payload.message);

  const eventName = toNullableString(payload.event) || toNullableString(payload.type) || "unknown";
  const externalThreadId =
    toNullableString(key.remoteJid) ||
    toNullableString(data.remoteJid) ||
    toNullableString(data.chatId) ||
    toNullableString(payload.chatId) ||
    toNullableString(payload.remoteJid) ||
    null;
  const externalMessageId =
    toNullableString(key.id) ||
    toNullableString(data.id) ||
    toNullableString(payload.messageId) ||
    null;
  const contactName =
    toNullableString(data.pushName) ||
    toNullableString(payload.pushName) ||
    toNullableString(data.senderName) ||
    toNullableString(payload.senderName) ||
    null;
  const contactPhone =
    toPhoneFromThreadId(externalThreadId) ||
    toPhoneFromThreadId(toNullableString(payload.from)) ||
    toNullableString(data.sender) ||
    null;
  const content =
    toNullableString(message.conversation) ||
    toNullableString(extendedText.text) ||
    toNullableString(messageContext.text) ||
    toNullableString(data.text) ||
    toNullableString(payload.text) ||
    null;
  const fromMe = toBoolean(key.fromMe) || toBoolean(data.fromMe) || toBoolean(payload.fromMe);
  const sentAt =
    toTimestampIso(data.messageTimestamp) ||
    toTimestampIso(payload.timestamp) ||
    new Date().toISOString();

  return {
    direction: fromMe ? "outbound" : "inbound",
    eventName,
    externalThreadId,
    externalMessageId,
    contactName,
    contactPhone,
    content,
    sentAt,
    payload,
  };
}

async function upsertInboxThreadFromWebhook(clinicId: string, parsed: ParsedEvolutionWebhookMessage) {
  if (!parsed.externalThreadId) {
    throw new HttpError(400, "Webhook sem identificador de conversa.");
  }

  const { data: existing, error: existingError } = await supabase
    .from("inbox_threads")
    .select(
      "id, clinic_id, channel, external_thread_id, contact_name, contact_phone, status, assigned_user_id, labels, unread_count, last_message_preview, last_message_at, metadata, created_at, updated_at"
    )
    .eq("clinic_id", clinicId)
    .eq("channel", "whatsapp")
    .eq("external_thread_id", parsed.externalThreadId)
    .maybeSingle();
  if (existingError) {
    throwIfEvolutionSchemaMissing(existingError);
    throw existingError;
  }

  const nowIso = new Date().toISOString();
  const status = parseInboxThreadStatus(existing?.status) || "open";
  const currentUnread = Number(existing?.unread_count || 0);
  const nextUnread = parsed.direction === "inbound" ? currentUnread + 1 : currentUnread;

  if (existing?.id) {
    const { data: updated, error: updateError } = await supabase
      .from("inbox_threads")
      .update({
        contact_name: parsed.contactName || existing.contact_name || null,
        contact_phone: parsed.contactPhone || existing.contact_phone || null,
        last_message_preview: parsed.content || existing.last_message_preview || null,
        last_message_at: parsed.sentAt,
        unread_count: nextUnread,
        status,
        updated_at: nowIso,
      })
      .eq("id", existing.id)
      .eq("clinic_id", clinicId)
      .select(
        "id, clinic_id, channel, external_thread_id, contact_name, contact_phone, status, assigned_user_id, labels, unread_count, last_message_preview, last_message_at, metadata, created_at, updated_at"
      )
      .single();
    if (updateError) {
      throwIfEvolutionSchemaMissing(updateError);
      throw updateError;
    }
    return updated as InboxThreadRow;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("inbox_threads")
    .insert({
      clinic_id: clinicId,
      channel: "whatsapp",
      external_thread_id: parsed.externalThreadId,
      contact_name: parsed.contactName,
      contact_phone: parsed.contactPhone,
      status: "open",
      labels: [],
      unread_count: parsed.direction === "inbound" ? 1 : 0,
      last_message_preview: parsed.content,
      last_message_at: parsed.sentAt,
      metadata: {},
      updated_at: nowIso,
    })
    .select(
      "id, clinic_id, channel, external_thread_id, contact_name, contact_phone, status, assigned_user_id, labels, unread_count, last_message_preview, last_message_at, metadata, created_at, updated_at"
    )
    .single();
  if (insertError) {
    throwIfEvolutionSchemaMissing(insertError);
    throw insertError;
  }
  return inserted as InboxThreadRow;
}

async function insertInboxMessageIfMissing(
  clinicId: string,
  threadId: number,
  parsed: ParsedEvolutionWebhookMessage
) {
  if (parsed.externalMessageId) {
    const { data: existing, error: existingError } = await supabase
      .from("inbox_messages")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("external_message_id", parsed.externalMessageId)
      .maybeSingle();
    if (existingError) {
      throwIfEvolutionSchemaMissing(existingError);
      throw existingError;
    }
    if (existing?.id) {
      return null;
    }
  }

  const { data, error } = await supabase
    .from("inbox_messages")
    .insert({
      clinic_id: clinicId,
      thread_id: threadId,
      direction: parsed.direction,
      message_type: "text",
      content: parsed.content,
      external_message_id: parsed.externalMessageId,
      sender_name: parsed.contactName,
      sender_phone: parsed.contactPhone,
      sent_at: parsed.sentAt,
      status: parsed.direction === "inbound" ? "received" : "sent",
      payload: parsed.payload,
    })
    .select(
      "id, clinic_id, thread_id, direction, message_type, content, external_message_id, sender_name, sender_phone, sent_by_user_id, sent_at, status, payload, created_at"
    )
    .single();
  if (error) {
    throwIfEvolutionSchemaMissing(error);
    throw error;
  }
  return data as InboxMessageRow;
}

async function countNotesByRange(
  clinicId: string,
  startIso: string,
  endIso: string,
  status?: "draft" | "final"
): Promise<number> {
  let query = supabase
    .from("notes")
    .select("id", { head: true, count: "exact" })
    .eq("clinic_id", clinicId)
    .gte("created_at", startIso)
    .lt("created_at", endIso);

  if (status) {
    query = query.eq("status", status);
  }

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

async function buildPatientNameMap(clinicId: string, patientIds: Array<number | null>) {
  const ids = Array.from(new Set(patientIds.filter((id): id is number => id !== null)));
  if (ids.length === 0) {
    return new Map<number, string>();
  }

  const { data, error } = await supabase
    .from("patients")
    .select("id, name")
    .eq("clinic_id", clinicId)
    .in("id", ids);

  if (error) throw error;
  return new Map((data ?? []).map((patient) => [Number(patient.id), patient.name]));
}

async function asaasRequest(pathname: string, init: RequestInit = {}) {
  if (!isAsaasConfigured()) {
    throw new HttpError(503, "Asaas integration is not configured.");
  }

  const headers = new Headers(init.headers ?? {});
  headers.set("accept", "application/json");
  headers.set("access_token", String(asaasApiKey));
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${asaasBaseUrl}${pathname}`, {
    ...init,
    headers,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new HttpError(
      response.status,
      payload?.errors?.[0]?.description || text || "Asaas request failed"
    );
  }

  return payload;
}

async function ensurePatientBelongsClinic(clinicId: string, patientId: number) {
  const { data, error } = await supabase
    .from("patients")
    .select("id, name, email, cpf, user_id, session_fee")
    .eq("id", patientId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new HttpError(404, "Patient not found in clinic.");
  }
  return data;
}

async function ensureProviderBelongsClinic(clinicId: string, providerUserId: string) {
  const { data, error } = await supabase
    .from("clinic_members")
    .select("id, role, active")
    .eq("clinic_id", clinicId)
    .eq("user_id", providerUserId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new HttpError(404, "Professional not found in clinic.");
  }
  const role = parseRole(data.role);
  if (role !== "admin" && role !== "professional") {
    throw new HttpError(400, "Selected provider must be admin or professional.");
  }
  return data;
}

async function assertProviderSlotAvailable(
  context: UserContext,
  providerUserId: string,
  startIso: string,
  endIso: string,
  options?: { excludeAppointmentIds?: number[] }
) {
  const excludeIds = Array.from(
    new Set((options?.excludeAppointmentIds ?? []).filter((id) => Number.isFinite(id) && id > 0))
  );

  let appointmentQuery = supabase
    .from("appointments")
    .select("id, start_time, end_time")
    .eq("clinic_id", context.clinicId)
    .eq("provider_user_id", providerUserId)
    .lt("start_time", endIso)
    .gt("end_time", startIso)
    .neq("status", "cancelled")
    .or("is_block.is.null,is_block.eq.false")
    .limit(1);

  if (excludeIds.length > 0) {
    appointmentQuery = appointmentQuery.not("id", "in", `(${excludeIds.join(",")})`);
  }

  const { data: conflicts, error: conflictError } = await appointmentQuery;
  if (conflictError) throw conflictError;
  if ((conflicts ?? []).length > 0) {
    throw new HttpError(
      409,
      "Conflito de agenda: profissional ja possui sessao no horario informado."
    );
  }

  const { data: blockConflicts, error: blockConflictError } = await supabase
    .from("calendar_blocks")
    .select("id, title, start_time, end_time")
    .eq("clinic_id", context.clinicId)
    .eq("provider_user_id", providerUserId)
    .lt("start_time", endIso)
    .gt("end_time", startIso)
    .limit(1);
  if (blockConflictError) throw blockConflictError;
  if ((blockConflicts ?? []).length > 0) {
    throw new HttpError(
      409,
      "Conflito de agenda: profissional possui bloqueio externo no horario informado."
    );
  }
}

async function syncPatientAsaasCustomer(context: UserContext, patientId: number) {
  const patient = await ensurePatientBelongsClinic(context.clinicId, patientId);

  const { data: existing, error: existingError } = await supabase
    .from("patient_billing_profile")
    .select("patient_id, asaas_customer_id")
    .eq("clinic_id", context.clinicId)
    .eq("patient_id", patientId)
    .maybeSingle();

  if (existingError) throw existingError;

  if (existing?.asaas_customer_id) {
    return { asaasCustomerId: String(existing.asaas_customer_id), patient };
  }

  const customer = await asaasRequest("/customers", {
    method: "POST",
    body: JSON.stringify({
      name: patient.name,
      email: toNullableString(patient.email) || undefined,
      cpfCnpj: toNullableString(patient.cpf) || undefined,
      externalReference: `smartpsi_patient_${patientId}`,
    }),
  });

  const asaasCustomerId = String(customer?.id || "");
  if (!asaasCustomerId) {
    throw new HttpError(502, "Asaas did not return customer id.");
  }

  const { error: upsertError } = await supabase.from("patient_billing_profile").upsert(
    {
      clinic_id: context.clinicId,
      patient_id: patientId,
      asaas_customer_id: asaasCustomerId,
      billing_owner_user_id: patient.user_id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "patient_id" }
  );

  if (upsertError) throw upsertError;
  return { asaasCustomerId, patient };
}

function isOpenOverdueStatus(statusRaw: unknown, dueDateRaw: unknown) {
  const status = String(statusRaw || "").toUpperCase();
  const dueDate = toDateOnly(dueDateRaw);

  if (status === "OVERDUE") return true;
  if (status === "PENDING" && dueDate) {
    const dueTimestamp = new Date(`${dueDate}T23:59:59.999Z`).getTime();
    return dueTimestamp < Date.now();
  }
  return false;
}

async function getPatientFinancialStatus(context: UserContext, patientId: number) {
  const { data, error } = await supabase
    .from("asaas_charges")
    .select("id, status, value, due_date")
    .eq("clinic_id", context.clinicId)
    .eq("patient_id", patientId)
    .order("due_date", { ascending: false });

  if (error) throw error;

  const charges = data ?? [];
  return {
    blocked: charges.some((item) => isOpenOverdueStatus(item.status, item.due_date)),
    overdueCount: charges.filter((item) => String(item.status || "").toUpperCase() === "OVERDUE")
      .length,
    pendingCount: charges.filter((item) => String(item.status || "").toUpperCase() === "PENDING")
      .length,
    charges,
  };
}

async function assertPatientCanSchedule(context: UserContext, patientId: number) {
  const status = await getPatientFinancialStatus(context, patientId);
  if (status.blocked) {
    throw new HttpError(409, "Patient has overdue financial pending items.");
  }
}

async function createAsaasChargeForAppointment(
  context: UserContext,
  patientId: number,
  appointmentId: number,
  dueDateIso: string,
  billingMode: BillingMode = "session",
  statementId?: number | null
) {
  if (!isAsaasConfigured()) return null;

  const { asaasCustomerId } = await syncPatientAsaasCustomer(context, patientId);
  const terms = await getPatientFinancialTerms(context, patientId);
  const dueDate = new Date(dueDateIso).toISOString().slice(0, 10);
  const sessionFee = Number(terms.session_fee || 0);
  const fallbackValue =
    Number.isFinite(asaasDefaultSessionValue) && asaasDefaultSessionValue > 0
      ? Number(asaasDefaultSessionValue.toFixed(2))
      : 150;
  const value = sessionFee > 0 ? Number(sessionFee.toFixed(2)) : fallbackValue;

  const payment = await asaasRequest("/payments", {
    method: "POST",
    body: JSON.stringify({
      customer: asaasCustomerId,
      billingType: "UNDEFINED",
      value,
      dueDate,
      description: `Sessao SmartPSI #${appointmentId}`,
      externalReference: `smartpsi_appointment_${appointmentId}`,
    }),
  });

  const chargeId = String(payment?.id || "");
  if (!chargeId) {
    throw new HttpError(502, "Asaas did not return payment id.");
  }

  const { error } = await supabase.from("asaas_charges").insert({
    clinic_id: context.clinicId,
    patient_id: patientId,
    appointment_id: appointmentId,
    asaas_charge_id: chargeId,
    status: String(payment?.status || "PENDING"),
    value,
    due_date: dueDate,
    billing_mode: billingMode,
    statement_id: statementId ?? null,
    last_payload: payment,
    updated_at: new Date().toISOString(),
  });

  if (error) throw error;
  return payment;
}

function normalizeAsaasChargeStatus(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function normalizeAsaasTenantStatus(rawStatus: unknown, eventName?: string | null): TenantStatus | null {
  const status = normalizeAsaasChargeStatus(rawStatus);
  if (status === "ACTIVE" || status === "RECEIVED" || status === "CONFIRMED") return "active";
  if (status === "TRIAL" || status === "PENDING") return "trialing";
  if (status === "OVERDUE" || status === "LATE") return "past_due";
  if (status === "SUSPENDED") return "suspended";
  if (status === "INACTIVE" || status === "EXPIRED" || status === "CANCELLED") return "cancelled";

  const event = String(eventName || "").toUpperCase();
  if (!event) return null;
  if (event.includes("OVERDUE")) return "past_due";
  if (event.includes("SUSPEND")) return "suspended";
  if (event.includes("RESTOR") || event.includes("REACTIV") || event.includes("ACTIV")) return "active";
  if (event.includes("CANCEL") || event.includes("DELETE") || event.includes("EXPIRE")) return "cancelled";
  return null;
}

function extractIdString(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (value && typeof value === "object") {
    return toNullableString((value as Record<string, unknown>).id);
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function addDaysToDateOnlyIso(dateOnly: string, days: number) {
  const parsed = toDateOnly(dateOnly);
  if (!parsed) return null;
  const [year, month, day] = parsed.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

type AsaasTenantReconcileResult = {
  handled: boolean;
  clinicId: string | null;
  asaasSubscriptionId: string | null;
  status: TenantStatus | null;
};

async function reconcileTenantSubscriptionFromAsaasWebhook(
  payload: Record<string, unknown>,
  eventName?: string | null
): Promise<AsaasTenantReconcileResult> {
  const subscriptionPayload = asRecord(payload.subscription);
  const paymentPayload = asRecord(payload.payment);

  const asaasSubscriptionId =
    extractIdString(subscriptionPayload) ||
    extractIdString(paymentPayload.subscription) ||
    toNullableString(payload.subscription_id);
  const asaasCustomerId =
    extractIdString(subscriptionPayload.customer) ||
    extractIdString(paymentPayload.customer) ||
    extractIdString(payload.customer);
  const rawStatus =
    toNullableString(subscriptionPayload.status) ||
    toNullableString(payload.status) ||
    toNullableString(paymentPayload.status);
  const nextDueDate = toDateOnly(
    subscriptionPayload.nextDueDate ||
      subscriptionPayload.next_due_date ||
      payload.nextDueDate ||
      payload.next_due_date
  );
  const cancellationReason =
    toNullableString(subscriptionPayload.cancellationReason) ||
    toNullableString(subscriptionPayload.reason) ||
    toNullableString(payload.reason);

  if (!asaasSubscriptionId && !asaasCustomerId) {
    return { handled: false, clinicId: null, asaasSubscriptionId: null, status: null };
  }
  try {
    let target: Record<string, unknown> | null = null;

    if (asaasSubscriptionId) {
      const { data, error } = await supabase
        .from("tenant_subscriptions")
        .select(
          "clinic_id, status, billing_provider, asaas_customer_id, asaas_subscription_id, payment_grace_until, blocked_at, suspended_reason, metadata"
        )
        .eq("asaas_subscription_id", asaasSubscriptionId)
        .maybeSingle();
      if (error) throw error;
      target = data || null;
    }

    if (!target && asaasCustomerId) {
      const { data, error } = await supabase
        .from("tenant_subscriptions")
        .select(
          "clinic_id, status, billing_provider, asaas_customer_id, asaas_subscription_id, payment_grace_until, blocked_at, suspended_reason, metadata"
        )
        .eq("asaas_customer_id", asaasCustomerId)
        .maybeSingle();
      if (error) throw error;
      target = data || null;
    }

    if (!target) {
      return {
        handled: false,
        clinicId: null,
        asaasSubscriptionId: asaasSubscriptionId || null,
        status: null,
      };
    }

    const currentStatus = parseTenantStatus(target.status) || "active";
    const mappedStatus = normalizeAsaasTenantStatus(rawStatus, eventName) || currentStatus;
    const nowIso = new Date().toISOString();
    const nextDueIso = nextDueDate ? `${nextDueDate}T00:00:00.000Z` : null;
    const graceUntil =
      mappedStatus === "past_due"
        ? addDaysToDateOnlyIso(nextDueDate || new Date().toISOString().slice(0, 10), 7) ||
          toNullableString(target.payment_grace_until)
        : null;

    const metadataBase =
      target.metadata && typeof target.metadata === "object"
        ? (target.metadata as Record<string, unknown>)
        : {};
    const metadata = {
      ...metadataBase,
      last_asaas_webhook_event: toNullableString(eventName) || null,
      last_asaas_raw_status: rawStatus || null,
      last_asaas_webhook_at: nowIso,
    };

    const { error: updateError } = await supabase
      .from("tenant_subscriptions")
      .update({
        status: mappedStatus,
        billing_provider: "asaas",
        asaas_subscription_id:
          asaasSubscriptionId || toNullableString(target.asaas_subscription_id),
        asaas_customer_id: asaasCustomerId || toNullableString(target.asaas_customer_id),
        current_period_end: nextDueIso || undefined,
        next_charge_at: nextDueIso || undefined,
        payment_grace_until: graceUntil,
        blocked_at:
          mappedStatus === "suspended" || mappedStatus === "cancelled"
            ? toNullableString(target.blocked_at) || nowIso
            : null,
        suspended_reason:
          mappedStatus === "suspended" || mappedStatus === "cancelled"
            ? cancellationReason || toNullableString(target.suspended_reason)
            : null,
        metadata,
        updated_at: nowIso,
      })
      .eq("clinic_id", String(target.clinic_id));
    if (updateError) throw updateError;

    await registerPlatformAuditLog({
      actorUserId: null,
      actorType: "system",
      action: "tenant.subscription.reconciled_from_asaas",
      targetType: "clinic",
      targetId: String(target.clinic_id),
      clinicId: String(target.clinic_id),
      metadata: {
        event: toNullableString(eventName) || null,
        asaas_subscription_id: asaasSubscriptionId || toNullableString(target.asaas_subscription_id),
        mapped_status: mappedStatus,
      },
    });

    return {
      handled: true,
      clinicId: String(target.clinic_id),
      asaasSubscriptionId:
        asaasSubscriptionId || toNullableString(target.asaas_subscription_id),
      status: mappedStatus,
    };
  } catch (error) {
    if (isMissingRelationError(error)) {
      return {
        handled: false,
        clinicId: null,
        asaasSubscriptionId: asaasSubscriptionId || null,
        status: null,
      };
    }
    throw error;
  }
}

function asaasChargeToFinancialStatus(statusRaw: unknown): "paid" | "pending" {
  const status = normalizeAsaasChargeStatus(statusRaw);
  if (
    status === "RECEIVED" ||
    status === "CONFIRMED" ||
    status === "RECEIVED_IN_CASH"
  ) {
    return "paid";
  }
  return "pending";
}

function resolveAsaasPaymentDateIso(payload: Record<string, unknown>, fallbackDueDate?: string | null) {
  const payment = payload.payment && typeof payload.payment === "object"
    ? (payload.payment as Record<string, unknown>)
    : {};

  const candidates = [
    toNullableString(payment.paymentDate),
    toNullableString(payment.clientPaymentDate),
    toNullableString(payment.creditDate),
    toNullableString(payment.confirmedDate),
    toNullableString(payload.paymentDate),
    fallbackDueDate ? `${fallbackDueDate}T00:00:00.000Z` : null,
  ].filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    const parsed = toDateTimeOrNull(candidate);
    if (parsed) return parsed;
  }

  return new Date().toISOString();
}

type AsaasChargeRow = {
  id: number;
  clinic_id: string;
  patient_id: number;
  appointment_id?: number | null;
  asaas_charge_id: string;
  status: string;
  value: number;
  due_date: string;
  billing_mode?: BillingMode | null;
  last_payload?: Record<string, unknown> | null;
};

async function reconcileAsaasChargeToFinancialRecord(
  charge: AsaasChargeRow,
  payload: Record<string, unknown>,
  statusRaw: string | null,
  dueDateRaw: string | null
) {
  const description = `Asaas charge ${charge.asaas_charge_id}`;
  const status = asaasChargeToFinancialStatus(statusRaw);
  const amountFromPayload = toNullableNumber(
    payload?.payment && typeof payload.payment === "object"
      ? (payload.payment as Record<string, unknown>).value
      : null
  );
  const amount = Number(amountFromPayload ?? toNullableNumber(charge.value) ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return;

  const referenceDate = resolveAsaasPaymentDateIso(payload, dueDateRaw);
  const category =
    charge.billing_mode === "monthly" ? "Mensalidade Asaas" : "Sessao Asaas";

  const { data: existingRecord, error: existingRecordError } = await supabase
    .from("financial_records")
    .select("id")
    .eq("clinic_id", charge.clinic_id)
    .eq("type", "income")
    .eq("description", description)
    .maybeSingle();
  if (existingRecordError) throw existingRecordError;

  if (existingRecord) {
    const { error: updateError } = await supabase
      .from("financial_records")
      .update({
        patient_id: charge.patient_id,
        amount: Number(amount.toFixed(2)),
        status,
        date: referenceDate,
        category,
      })
      .eq("id", existingRecord.id)
      .eq("clinic_id", charge.clinic_id);
    if (updateError) throw updateError;
    return;
  }

  const { data: patientRow, error: patientRowError } = await supabase
    .from("patients")
    .select("id, user_id")
    .eq("clinic_id", charge.clinic_id)
    .eq("id", charge.patient_id)
    .maybeSingle();
  if (patientRowError) throw patientRowError;
  if (!patientRow?.user_id) return;

  const { error: insertError } = await supabase.from("financial_records").insert({
    clinic_id: charge.clinic_id,
    user_id: patientRow.user_id,
    patient_id: charge.patient_id,
    amount: Number(amount.toFixed(2)),
    type: "income",
    category,
    description,
    date: referenceDate,
    status,
  });
  if (insertError) throw insertError;
}

async function cancelAsaasChargesForAppointments(context: UserContext, appointmentIds: number[]) {
  const uniqueAppointmentIds = Array.from(
    new Set(appointmentIds.filter((id) => Number.isFinite(id) && id > 0))
  );
  if (uniqueAppointmentIds.length === 0) return;

  const { data: charges, error: chargesError } = await supabase
    .from("asaas_charges")
    .select("*")
    .eq("clinic_id", context.clinicId)
    .in("appointment_id", uniqueAppointmentIds);
  if (chargesError) throw chargesError;

  for (const rawCharge of charges ?? []) {
    const charge = rawCharge as AsaasChargeRow;
    if (isAsaasConfigured()) {
      try {
        await asaasRequest(`/payments/${encodeURIComponent(charge.asaas_charge_id)}`, {
          method: "DELETE",
        });
      } catch (error) {
        console.warn("[cancelAsaasChargesForAppointments]", error);
      }
    }

    const cancellationPayload: Record<string, unknown> = {
      event: "PAYMENT_DELETED",
      payment: {
        id: charge.asaas_charge_id,
        status: "CANCELLED",
        dueDate: charge.due_date,
        value: charge.value,
      },
    };

    const { error: updateChargeError } = await supabase
      .from("asaas_charges")
      .update({
        status: "CANCELLED",
        last_payload: cancellationPayload,
        updated_at: new Date().toISOString(),
      })
      .eq("id", charge.id)
      .eq("clinic_id", context.clinicId);
    if (updateChargeError) throw updateChargeError;

    await reconcileAsaasChargeToFinancialRecord(
      charge,
      cancellationPayload,
      "CANCELLED",
      toNullableString(charge.due_date)
    );
  }
}

async function buildUserNameMap(userIds: string[]) {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  const map = new Map<string, string>();
  await Promise.all(
    unique.map(async (userId) => {
      const { data, error } = await supabase.auth.admin.getUserById(userId);
      if (error || !data?.user) {
        map.set(userId, userId.slice(0, 8));
        return;
      }
      map.set(
        userId,
        String(data.user.user_metadata?.full_name || data.user.email || userId.slice(0, 8))
      );
    })
  );
  return map;
}

async function getClinicBillingSettings(clinicId: string) {
  const defaults = defaultClinicBillingSettings();
  const { data, error } = await supabase
    .from("clinic_billing_settings")
    .select("*")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return {
      clinic_id: clinicId,
      ...defaults,
    };
  }
  return {
    clinic_id: clinicId,
    default_billing_mode:
      normalizeBillingMode(data.default_billing_mode) || defaults.default_billing_mode,
    monthly_generation_day:
      toNullableNumber(data.monthly_generation_day) || defaults.monthly_generation_day,
    timezone: toNullableString(data.timezone) || defaults.timezone,
    auto_generate_monthly:
      typeof data.auto_generate_monthly === "boolean"
        ? data.auto_generate_monthly
        : defaults.auto_generate_monthly,
  };
}

async function getClinicAsaasSettings(clinicId: string) {
  const defaults = defaultClinicAsaasSettings();
  const { data, error } = await supabase
    .from("clinic_asaas_settings")
    .select("*")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return {
      clinic_id: clinicId,
      ...defaults,
    };
  }
  const preset = normalizeGoogleReminderPreset(data.reminder_preset);
  return {
    clinic_id: clinicId,
    reminder_preset: preset,
    reminder_channels:
      Array.isArray(data.reminder_channels) && data.reminder_channels.length > 0
        ? data.reminder_channels
        : defaults.reminder_channels,
    reminder_timeline:
      Array.isArray(data.reminder_timeline) && data.reminder_timeline.length > 0
        ? data.reminder_timeline
        : buildReminderPresetTimeline(preset),
    default_due_days: toNullableNumber(data.default_due_days) || defaults.default_due_days,
    late_fee_percent: toNullableNumber(data.late_fee_percent) || defaults.late_fee_percent,
    interest_percent: toNullableNumber(data.interest_percent) || defaults.interest_percent,
  };
}

async function getEffectiveBillingMode(context: UserContext, patientId: number) {
  const [{ data: patient, error: patientError }, settings] = await Promise.all([
    supabase
      .from("patients")
      .select("id, clinic_id, billing_mode_override")
      .eq("clinic_id", context.clinicId)
      .eq("id", patientId)
      .maybeSingle(),
    getClinicBillingSettings(context.clinicId),
  ]);
  if (patientError) throw patientError;
  if (!patient) throw new HttpError(404, "Patient not found in clinic.");
  return (
    normalizeBillingMode(patient.billing_mode_override) || settings.default_billing_mode || "session"
  );
}

type GoogleConnection = {
  id: number;
  clinic_id: string;
  user_id: string;
  google_email: string | null;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  expires_at: string | null;
  active: boolean;
};

async function googleFetch(
  accessToken: string,
  pathname: string,
  init: RequestInit = {},
  query?: Record<string, string>
) {
  const url = new URL(`https://www.googleapis.com${pathname}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  }
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new HttpError(
      response.status,
      payload?.error?.message || payload?.error_description || text || "Google API request failed"
    );
  }
  return payload;
}

async function googleOAuthTokenRequest(params: Record<string, string>) {
  const body = new URLSearchParams(params);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new HttpError(
      response.status,
      payload?.error_description || payload?.error || "Google OAuth token exchange failed"
    );
  }
  return payload as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    token_type: string;
    id_token?: string;
  };
}

async function getGoogleUserProfile(accessToken: string) {
  const profile = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await profile.text();
  const payload = text ? JSON.parse(text) : null;
  if (!profile.ok) {
    throw new HttpError(502, payload?.error_description || "Failed to fetch Google user profile");
  }
  return payload as { email?: string; name?: string };
}

async function getGoogleConnection(clinicId: string, userId: string) {
  const { data, error } = await supabase
    .from("google_user_connections")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  return (data as GoogleConnection | null) || null;
}

async function getValidGoogleAccessToken(context: UserContext, userId: string) {
  const connection = await getGoogleConnection(context.clinicId, userId);
  if (!connection) {
    return null;
  }
  const now = Date.now();
  const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : 0;
  if (expiresAt > now + 60_000) {
    return {
      connection,
      accessToken: decryptSecret(connection.access_token_encrypted),
    };
  }

  const refreshToken = decryptSecret(connection.refresh_token_encrypted);
  const refreshed = await googleOAuthTokenRequest({
    client_id: googleClientId,
    client_secret: googleClientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const nextExpiresAt = new Date(Date.now() + Number(refreshed.expires_in || 3600) * 1000)
    .toISOString();
  const { data, error } = await supabase
    .from("google_user_connections")
    .update({
      access_token_encrypted: encryptSecret(refreshed.access_token),
      expires_at: nextExpiresAt,
      updated_at: new Date().toISOString(),
      active: true,
    })
    .eq("id", connection.id)
    .select("*")
    .single();
  if (error) throw error;
  return {
    connection: data as GoogleConnection,
    accessToken: refreshed.access_token,
  };
}

async function ensureGoogleConnectionForContext(context: UserContext, userId?: string) {
  if (!isGoogleConfigured()) {
    throw new HttpError(
      503,
      "Google integration not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI."
    );
  }
  const targetUserId = userId || context.userId;
  const tokenData = await getValidGoogleAccessToken(context, targetUserId);
  if (!tokenData) {
    throw new HttpError(409, "Google account is not connected for this professional.");
  }
  return tokenData;
}

async function stopGoogleWatchChannel(
  accessToken: string,
  channelId: string,
  resourceId: string
) {
  try {
    await googleFetch(accessToken, "/calendar/v3/channels/stop", {
      method: "POST",
      body: JSON.stringify({
        id: channelId,
        resourceId,
      }),
    });
  } catch (error) {
    console.warn("[stopGoogleWatchChannel]", error);
  }
}

async function ensureGoogleWatchChannel(
  context: UserContext,
  providerUserId: string,
  accessToken: string
) {
  if (!isGoogleConfigured()) return null;

  const baseUrl = String(appUrl || "").replace(/\/+$/, "");
  if (!baseUrl) return null;

  const webhookUrl = `${baseUrl}/api/integrations/google/webhook`;
  const channelId = `smartpsi-${providerUserId.slice(0, 8)}-${crypto.randomUUID()}`;

  const watchPayload = {
    id: channelId,
    type: "web_hook",
    address: webhookUrl,
    token: googleWebhookToken || undefined,
    params: {
      ttl: String(7 * 24 * 60 * 60),
    },
  };

  const result = await googleFetch(
    accessToken,
    `/calendar/v3/calendars/${encodeURIComponent("primary")}/events/watch`,
    {
      method: "POST",
      body: JSON.stringify(watchPayload),
    }
  );

  const resourceId = toNullableString(result?.resourceId);
  const calendarId = "primary";
  if (!resourceId) {
    throw new HttpError(502, "Google watch channel missing resourceId.");
  }

  const expirationRaw = toNullableNumber(result?.expiration);
  const expirationAt =
    expirationRaw && Number.isFinite(expirationRaw)
      ? new Date(Number(expirationRaw)).toISOString()
      : null;

  const { data: currentChannels, error: channelsError } = await supabase
    .from("google_watch_channels")
    .select("id, channel_id, resource_id")
    .eq("clinic_id", context.clinicId)
    .eq("user_id", providerUserId)
    .eq("calendar_id", calendarId)
    .eq("active", true);
  if (channelsError) throw channelsError;

  for (const channel of currentChannels ?? []) {
    const prevChannelId = toNullableString(channel.channel_id);
    const prevResourceId = toNullableString(channel.resource_id);
    if (prevChannelId && prevResourceId) {
      await stopGoogleWatchChannel(accessToken, prevChannelId, prevResourceId);
    }
  }

  if ((currentChannels ?? []).length > 0) {
    const { error: deactivateError } = await supabase
      .from("google_watch_channels")
      .update({ active: false })
      .eq("clinic_id", context.clinicId)
      .eq("user_id", providerUserId)
      .eq("calendar_id", calendarId)
      .eq("active", true);
    if (deactivateError) throw deactivateError;
  }

  const { data, error } = await supabase
    .from("google_watch_channels")
    .insert({
      clinic_id: context.clinicId,
      user_id: providerUserId,
      calendar_id: calendarId,
      channel_id: channelId,
      resource_id: resourceId,
      expiration_at: expirationAt,
      active: true,
      created_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

function buildAppointmentSummary(appointment: Record<string, unknown>, primaryName: string | null, secondaryName: string | null) {
  const sessionType = normalizeSessionType(appointment.session_type) || "individual";
  const mode = normalizeSessionMode(appointment.session_mode) || "in_person";
  if (sessionType === "couple") {
    return `Terapia de casal: ${primaryName || "Paciente"} + ${secondaryName || "Paciente 2"} (${mode === "online" ? "Online" : "Presencial"})`;
  }
  return `Sessao: ${primaryName || "Paciente"} (${mode === "online" ? "Online" : "Presencial"})`;
}

async function syncAppointmentToGoogle(
  context: UserContext,
  appointment: Record<string, unknown>,
  primaryName: string | null,
  secondaryName: string | null
) {
  if (!isGoogleConfigured()) return;
  if (appointment.is_block) return;

  const providerUserId =
    toNullableString(appointment.provider_user_id) || toNullableString(appointment.user_id) || context.userId;
  const token = await getValidGoogleAccessToken(context, providerUserId);
  if (!token) return;

  const calendarId = toNullableString(appointment.google_calendar_id) || "primary";
  const eventPayload = {
    summary: buildAppointmentSummary(appointment, primaryName, secondaryName),
    description: toNullableString(appointment.notes) || undefined,
    start: {
      dateTime: String(appointment.start_time),
      timeZone: "America/Sao_Paulo",
    },
    end: {
      dateTime: String(appointment.end_time),
      timeZone: "America/Sao_Paulo",
    },
    location:
      normalizeSessionMode(appointment.session_mode) === "in_person" ? "Atendimento presencial" : undefined,
    hangoutLink:
      normalizeSessionMode(appointment.session_mode) === "online"
        ? toNullableString(appointment.online_meeting_url) || undefined
        : undefined,
    extendedProperties: {
      private: {
        smartpsiAppointmentId: String(appointment.id),
        smartpsiClinicId: context.clinicId,
      },
    },
  };

  try {
    const currentEventId = toNullableString(appointment.google_event_id);
    const method = currentEventId ? "PATCH" : "POST";
    const path = currentEventId
      ? `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(
          currentEventId
        )}`
      : `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    const result = await googleFetch(token.accessToken, path, {
      method,
      body: JSON.stringify(eventPayload),
    });

    await supabase
      .from("appointments")
      .update({
        google_event_id: String(result?.id || currentEventId),
        google_calendar_id: calendarId,
        google_sync_status: "synced",
        google_last_synced_at: new Date().toISOString(),
      })
      .eq("id", appointment.id)
      .eq("clinic_id", context.clinicId);
  } catch (error) {
    console.error("[syncAppointmentToGoogle]", error);
    await supabase
      .from("appointments")
      .update({
        google_sync_status: "failed",
        google_last_synced_at: new Date().toISOString(),
      })
      .eq("id", appointment.id)
      .eq("clinic_id", context.clinicId);
  }
}

async function deleteAppointmentFromGoogle(context: UserContext, appointment: Record<string, unknown>) {
  if (!isGoogleConfigured()) return;
  const providerUserId =
    toNullableString(appointment.provider_user_id) || toNullableString(appointment.user_id) || context.userId;
  const eventId = toNullableString(appointment.google_event_id);
  if (!eventId) return;

  const token = await getValidGoogleAccessToken(context, providerUserId);
  if (!token) return;
  const calendarId = toNullableString(appointment.google_calendar_id) || "primary";

  try {
    await googleFetch(
      token.accessToken,
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE" }
    );
  } catch (error) {
    console.error("[deleteAppointmentFromGoogle]", error);
  }
}

async function importExternalGoogleEventsAsBlocks(
  context: UserContext,
  providerUserId: string,
  accessToken: string
) {
  const now = new Date();
  const minTime = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const maxTime = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();

  const events = await googleFetch(
    accessToken,
    `/calendar/v3/calendars/${encodeURIComponent("primary")}/events`,
    { method: "GET" },
    {
      singleEvents: "true",
      orderBy: "startTime",
      timeMin: minTime,
      timeMax: maxTime,
      maxResults: "250",
    }
  );
  const items = Array.isArray(events?.items) ? events.items : [];

  for (const event of items) {
    const eventId = toNullableString(event.id);
    if (!eventId || String(event.status || "").toLowerCase() === "cancelled") {
      continue;
    }

    const smartpsiAppointmentId = toNullableString(
      event.extendedProperties?.private?.smartpsiAppointmentId
    );
    if (smartpsiAppointmentId) {
      const appointmentId = Number(smartpsiAppointmentId);
      if (Number.isFinite(appointmentId) && appointmentId > 0) {
        await supabase
          .from("appointments")
          .update({
            start_time: toDateTimeOrNull(event.start?.dateTime) || undefined,
            end_time: toDateTimeOrNull(event.end?.dateTime) || undefined,
            notes: toNullableString(event.description) || undefined,
            session_mode: toNullableString(event.location) ? "in_person" : undefined,
            online_meeting_url: toNullableString(event.hangoutLink) || undefined,
            google_sync_status: "synced",
            google_last_synced_at: new Date().toISOString(),
          })
          .eq("clinic_id", context.clinicId)
          .eq("id", appointmentId);
      }
      continue;
    }

    const startTime =
      toDateTimeOrNull(event.start?.dateTime || event.start?.date) || null;
    const endTime = toDateTimeOrNull(event.end?.dateTime || event.end?.date) || null;
    if (!startTime || !endTime) continue;

    const { data: exists, error: existsError } = await supabase
      .from("calendar_blocks")
      .select("id")
      .eq("clinic_id", context.clinicId)
      .eq("provider_user_id", providerUserId)
      .eq("google_event_id", eventId)
      .maybeSingle();
    if (existsError) throw existsError;
    if (exists) continue;

    await supabase.from("calendar_blocks").insert({
      clinic_id: context.clinicId,
      provider_user_id: providerUserId,
      title: toNullableString(event.summary) || "Compromisso externo",
      start_time: startTime,
      end_time: endTime,
      google_event_id: eventId,
      source: "google_external",
    });
  }
}

function resolveMonthRange(monthInput: string) {
  const valid = String(monthInput || "").match(/^(\d{4})-(\d{2})$/);
  if (!valid) {
    throw new HttpError(400, "Invalid month. Use YYYY-MM.");
  }
  const year = Number(valid[1]);
  const month = Number(valid[2]);
  if (month < 1 || month > 12) {
    throw new HttpError(400, "Invalid month value.");
  }
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  return {
    period: `${valid[1]}-${valid[2]}`,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

async function getPatientFinancialTerms(context: UserContext, patientId: number) {
  const [{ data: patient, error: patientError }, billingSettings] = await Promise.all([
    supabase
      .from("patients")
      .select("id, clinic_id, name, session_fee, billing_mode_override")
      .eq("clinic_id", context.clinicId)
      .eq("id", patientId)
      .maybeSingle(),
    getClinicBillingSettings(context.clinicId),
  ]);
  if (patientError) throw patientError;
  if (!patient) throw new HttpError(404, "Patient not found");

  const sessionFee = toNullableNumber(patient.session_fee) || 0;
  const overrideMode = normalizeBillingMode(patient.billing_mode_override);
  const effectiveMode = overrideMode || billingSettings.default_billing_mode || "session";

  return {
    patient_id: patientId,
    patient_name: patient.name,
    session_fee: sessionFee,
    billing_mode_override: overrideMode,
    default_billing_mode: billingSettings.default_billing_mode,
    effective_billing_mode: effectiveMode,
  };
}

async function computePatientMonthlySummary(
  context: UserContext,
  patientId: number,
  monthInput: string
) {
  const { period, startIso, endIso } = resolveMonthRange(monthInput);
  const terms = await getPatientFinancialTerms(context, patientId);

  const [appointmentsResult, paidResult, statementResult] = await Promise.all([
    supabase
      .from("appointments")
      .select("id, start_time, status")
      .eq("clinic_id", context.clinicId)
      .eq("patient_id", patientId)
      .gte("start_time", startIso)
      .lt("start_time", endIso)
      .in("status", ["scheduled", "completed"])
      .order("start_time", { ascending: true }),
    supabase
      .from("financial_records")
      .select("id, amount")
      .eq("clinic_id", context.clinicId)
      .eq("patient_id", patientId)
      .eq("type", "income")
      .eq("status", "paid")
      .gte("date", startIso)
      .lt("date", endIso),
    supabase
      .from("patient_monthly_statements")
      .select("*")
      .eq("clinic_id", context.clinicId)
      .eq("patient_id", patientId)
      .eq("period_ym", period)
      .maybeSingle(),
  ]);
  if (appointmentsResult.error) throw appointmentsResult.error;
  if (paidResult.error) throw paidResult.error;
  if (statementResult.error) throw statementResult.error;

  const appointments = appointmentsResult.data ?? [];
  const paidAmount = (paidResult.data ?? []).reduce(
    (acc, item) => acc + Number(item.amount || 0),
    0
  );
  const sessionCount = appointments.length;
  const unitPrice = terms.session_fee;
  const grossAmount = Number((sessionCount * unitPrice).toFixed(2));
  const outstandingAmount = Number(Math.max(0, grossAmount - paidAmount).toFixed(2));

  return {
    period,
    patient_id: patientId,
    patient_name: terms.patient_name,
    billing_mode: terms.effective_billing_mode,
    session_count: sessionCount,
    unit_price: unitPrice,
    gross_amount: grossAmount,
    paid_amount: Number(paidAmount.toFixed(2)),
    outstanding_amount: outstandingAmount,
    appointments,
    statement: statementResult.data || null,
  };
}

async function generateMonthlyStatementsForPeriod(
  context: UserContext,
  monthInput: string,
  options?: { patientId?: number; force?: boolean }
) {
  const { period } = resolveMonthRange(monthInput);
  const billingSettings = await getClinicBillingSettings(context.clinicId);

  const patientsQuery = supabase
    .from("patients")
    .select("id, name, session_fee, billing_mode_override")
    .eq("clinic_id", context.clinicId)
    .order("name", { ascending: true });
  if (options?.patientId) {
    patientsQuery.eq("id", options.patientId);
  }
  const { data: patients, error: patientsError } = await patientsQuery;
  if (patientsError) throw patientsError;

  const generated: Array<Record<string, unknown>> = [];
  for (const patient of patients ?? []) {
    const mode =
      normalizeBillingMode(patient.billing_mode_override) || billingSettings.default_billing_mode;
    if (mode !== "monthly") {
      continue;
    }

    const summary = await computePatientMonthlySummary(context, Number(patient.id), period);
    const status =
      summary.outstanding_amount <= 0
        ? "settled"
        : summary.paid_amount > 0
        ? "partial"
        : "open";

    const { data: statementData, error: statementError } = await supabase
      .from("patient_monthly_statements")
      .upsert(
        {
          clinic_id: context.clinicId,
          patient_id: patient.id,
          period_ym: period,
          session_count: summary.session_count,
          unit_price: summary.unit_price,
          gross_amount: summary.gross_amount,
          paid_amount: summary.paid_amount,
          outstanding_amount: summary.outstanding_amount,
          status,
          updated_at: new Date().toISOString(),
          generated_at: new Date().toISOString(),
        },
        { onConflict: "clinic_id,patient_id,period_ym" }
      )
      .select("*")
      .single();
    if (statementError) throw statementError;

    await supabase
      .from("patient_monthly_statement_items")
      .delete()
      .eq("statement_id", statementData.id);

    if (summary.appointments.length > 0) {
      const rows = summary.appointments.map((item: Record<string, unknown>) => ({
        statement_id: statementData.id,
        appointment_id: Number(item.id),
        amount: summary.unit_price,
      }));
      const { error: itemsError } = await supabase
        .from("patient_monthly_statement_items")
        .insert(rows);
      if (itemsError) throw itemsError;
    }

    let asaasChargeId: string | null = toNullableString(statementData.asaas_charge_id);
    if (summary.outstanding_amount > 0 && isAsaasConfigured()) {
      const { asaasCustomerId } = await syncPatientAsaasCustomer(context, Number(patient.id));
      const dueDate = new Date(
        Date.UTC(
          Number(period.slice(0, 4)),
          Number(period.slice(5, 7)),
          Math.min(28, Number(billingSettings.monthly_generation_day || 5))
        )
      )
        .toISOString()
        .slice(0, 10);

      if (!asaasChargeId || options?.force) {
        const payment = await asaasRequest("/payments", {
          method: "POST",
          body: JSON.stringify({
            customer: asaasCustomerId,
            billingType: "UNDEFINED",
            value: summary.outstanding_amount,
            dueDate,
            description: `Mensalidade SmartPSI ${period} - ${summary.patient_name || "Paciente"}`,
            externalReference: `smartpsi_statement_${statementData.id}`,
          }),
        });

        asaasChargeId = String(payment?.id || "");
        if (asaasChargeId) {
          await supabase
            .from("asaas_charges")
            .upsert(
              {
                clinic_id: context.clinicId,
                patient_id: patient.id,
                appointment_id: null,
                asaas_charge_id: asaasChargeId,
                status: String(payment?.status || "PENDING"),
                value: summary.outstanding_amount,
                due_date: dueDate,
                billing_mode: "monthly",
                statement_id: statementData.id,
                last_payload: payment,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "asaas_charge_id" }
            );
        }
      }
    }

    if (asaasChargeId) {
      await supabase
        .from("patient_monthly_statements")
        .update({ asaas_charge_id: asaasChargeId, updated_at: new Date().toISOString() })
        .eq("id", statementData.id);
    }

    generated.push({
      patient_id: patient.id,
      patient_name: patient.name,
      statement_id: statementData.id,
      outstanding_amount: summary.outstanding_amount,
      status,
    });
  }

  return {
    period,
    generated_count: generated.length,
    generated,
  };
}

type TenantSubscriptionRow = {
  clinic_id: string;
  plan_code: string | null;
  status: TenantStatus | null;
  billing_provider: BillingProvider | null;
  asaas_customer_id: string | null;
  asaas_subscription_id: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  payment_grace_until: string | null;
  next_charge_at: string | null;
  blocked_at: string | null;
  suspended_reason: string | null;
  updated_at: string | null;
};

const defaultSuperadminFeatureKeys = [
  "billing.asaas",
  "messaging.evolution",
  "messaging.inbox",
  "crm.kanban",
  "crm.pipeline_automation",
  "ai.assistant",
];

function normalizeFeatureKey(value: unknown) {
  const raw = toNullableString(value);
  if (!raw) return null;
  if (!/^[a-z0-9._-]+$/i.test(raw)) return null;
  return raw.toLowerCase();
}

function subscriptionToResponse(
  subscription: Partial<TenantSubscriptionRow> | null | undefined
): TenantSubscriptionRow {
  return {
    clinic_id: String(subscription?.clinic_id || ""),
    plan_code: toNullableString(subscription?.plan_code) || "starter",
    status: parseTenantStatus(subscription?.status) || "active",
    billing_provider: parseBillingProvider(subscription?.billing_provider) || "manual",
    asaas_customer_id: toNullableString(subscription?.asaas_customer_id),
    asaas_subscription_id: toNullableString(subscription?.asaas_subscription_id),
    trial_ends_at: toNullableString(subscription?.trial_ends_at),
    current_period_start: toNullableString(subscription?.current_period_start),
    current_period_end: toNullableString(subscription?.current_period_end),
    payment_grace_until: toNullableString(subscription?.payment_grace_until),
    next_charge_at: toNullableString(subscription?.next_charge_at),
    blocked_at: toNullableString(subscription?.blocked_at),
    suspended_reason: toNullableString(subscription?.suspended_reason),
    updated_at: toNullableString(subscription?.updated_at),
  };
}

async function ensureClinicExistsOrThrow(clinicId: string) {
  const { data, error } = await supabase
    .from("clinics")
    .select("id, name, owner_user_id, created_at")
    .eq("id", clinicId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Clinica nao encontrada.");
  return data;
}

function throwIfSuperadminSchemaMissing(error: unknown) {
  if (isMissingRelationError(error)) {
    throw new HttpError(
      503,
      "Database schema is outdated. Run migration 20260225_007_superadmin_platform_foundation.sql."
    );
  }
}

async function syncTenantSubscriptionFromAsaas(clinicId: string) {
  const { data: current, error: currentError } = await supabase
    .from("tenant_subscriptions")
    .select(
      "clinic_id, plan_code, status, billing_provider, asaas_customer_id, asaas_subscription_id, trial_ends_at, current_period_start, current_period_end, payment_grace_until, next_charge_at, blocked_at, suspended_reason, metadata, updated_at"
    )
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current) {
    throw new HttpError(404, "Assinatura da clinica nao encontrada.");
  }

  const asaasSubscriptionId = toNullableString(current.asaas_subscription_id);
  if (!asaasSubscriptionId) {
    throw new HttpError(400, "Clinica sem asaas_subscription_id configurado.");
  }

  const payload = await asaasRequest(`/subscriptions/${encodeURIComponent(asaasSubscriptionId)}`, {
    method: "GET",
  });
  const rawStatus = toNullableString(payload?.status);
  const mappedStatus =
    normalizeAsaasTenantStatus(rawStatus) || parseTenantStatus(current.status) || "active";
  const nextDueDate = toDateOnly(payload?.nextDueDate || payload?.next_due_date);
  const nextDueIso = nextDueDate ? `${nextDueDate}T00:00:00.000Z` : null;
  const nowIso = new Date().toISOString();

  const paymentGraceUntil =
    mappedStatus === "past_due"
      ? addDaysToDateOnlyIso(nextDueDate || nowIso.slice(0, 10), 7) ||
        toNullableString(current.payment_grace_until)
      : null;

  const metadataBase =
    current.metadata && typeof current.metadata === "object"
      ? (current.metadata as Record<string, unknown>)
      : {};
  const metadata = {
    ...metadataBase,
    last_asaas_subscription_sync_at: nowIso,
    last_asaas_subscription_status_raw: rawStatus || null,
  };

  const { data: updated, error: updateError } = await supabase
    .from("tenant_subscriptions")
    .update({
      status: mappedStatus,
      billing_provider: "asaas",
      asaas_subscription_id: asaasSubscriptionId,
      asaas_customer_id: toNullableString(payload?.customer) || toNullableString(current.asaas_customer_id),
      current_period_end: nextDueIso || undefined,
      next_charge_at: nextDueIso || undefined,
      payment_grace_until: paymentGraceUntil,
      blocked_at:
        mappedStatus === "suspended" || mappedStatus === "cancelled"
          ? toNullableString(current.blocked_at) || nowIso
          : null,
      suspended_reason:
        mappedStatus === "suspended" || mappedStatus === "cancelled"
          ? toNullableString(payload?.reason) || toNullableString(current.suspended_reason)
          : null,
      metadata,
      updated_at: nowIso,
    })
    .eq("clinic_id", clinicId)
    .select(
      "clinic_id, plan_code, status, billing_provider, asaas_customer_id, asaas_subscription_id, trial_ends_at, current_period_start, current_period_end, payment_grace_until, next_charge_at, blocked_at, suspended_reason, updated_at"
    )
    .single();
  if (updateError) throw updateError;

  return {
    subscription: subscriptionToResponse(updated as TenantSubscriptionRow),
    asaas: {
      id: toNullableString(payload?.id) || asaasSubscriptionId,
      status: rawStatus,
      next_due_date: nextDueDate,
    },
  };
}

type CreateAppOptions = {
  includeFrontend?: boolean;
};

export async function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const includeFrontend = options.includeFrontend ?? true;
  await bootstrapSuperadminsFromEnv();

  const defaultCorsOrigins = [appUrl, adminUrl].filter((item): item is string => Boolean(item));
  const effectiveCorsOrigins =
    corsAllowedOrigins.length > 0 ? corsAllowedOrigins : defaultCorsOrigins;
  const globalLimiter = rateLimit({
    windowMs: Number.isFinite(rateLimitWindowMs) ? rateLimitWindowMs : 15 * 60 * 1000,
    max: Number.isFinite(rateLimitMax) ? rateLimitMax : 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === "/api/health",
  });
  const sensitiveLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    const requestId = crypto.randomUUID();
    const start = Date.now();
    res.setHeader("x-request-id", requestId);
    console.log(
      JSON.stringify({
        level: "info",
        event: "request_start",
        request_id: requestId,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
      })
    );
    res.on("finish", () => {
      console.log(
        JSON.stringify({
          level: "info",
          event: "request_end",
          request_id: requestId,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          duration_ms: Date.now() - start,
        })
      );
    });
    next();
  });
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          connectSrc: buildConnectSrc(),
        },
      },
    })
  );
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        if (!isProduction || effectiveCorsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: true,
    })
  );
  app.use(compression());
  app.use(globalLimiter);

  app.use(express.json({ limit: "50mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      supabaseConfigured: Boolean(supabaseUrl && supabaseServiceRoleKey),
      geminiConfigured: Boolean(geminiApiKey),
      allowDevUserBypass,
      asaasFeatureEnabled: featureAsaasEnabled,
      googleFeatureEnabled: featureGoogleEnabled,
      asaasConfigured: isAsaasConfigured(),
      googleConfigured: isGoogleConfigured(),
      evolutionWebhookConfigured: Boolean(evolutionWebhookToken),
      superadminHostsConfigured: superadminAllowedHosts,
      superadminBootstrapConfigured: superadminBootstrapUserIds.length > 0,
    });
  });

  app.get("/api/me", sensitiveLimiter, async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    res.json({
      user_id: context.userId,
      clinic_id: context.clinicId,
      role: context.role,
    });
  });

  app.get("/api/superadmin/me", sensitiveLimiter, async (req, res) => {
    const context = await requireSuperadminContext(req, res);
    if (!context) return;

    try {
      const [authUser, profile] = await Promise.all([
        supabase.auth.admin.getUserById(context.userId),
        supabase
          .from("platform_superadmins")
          .select("user_id, full_name, email, active, created_at, updated_at")
          .eq("user_id", context.userId)
          .maybeSingle(),
      ]);

      if (authUser.error) throw authUser.error;
      if (profile.error) {
        throwIfSuperadminSchemaMissing(profile.error);
        throw profile.error;
      }

      const user = authUser.data?.user;
      res.json({
        user_id: context.userId,
        email: profile.data?.email || user?.email || null,
        full_name: profile.data?.full_name || user?.user_metadata?.full_name || null,
        active: profile.data?.active !== false,
        allowed_hosts: superadminAllowedHosts,
      });
    } catch (error) {
      handleRouteError(res, error, "GET /api/superadmin/me");
    }
  });

  app.get("/api/superadmin/dashboard/overview", async (req, res) => {
    const context = await requireSuperadminContext(req, res);
    if (!context) return;

    try {
      const { data: clinics, error: clinicsError } = await supabase
        .from("clinics")
        .select("id, name, created_at")
        .order("created_at", { ascending: false });
      if (clinicsError) throw clinicsError;

      const clinicIds = (clinics || []).map((clinic) => String(clinic.id));
      let subscriptions: Array<Record<string, unknown>> = [];
      let members: Array<Record<string, unknown>> = [];

      if (clinicIds.length > 0) {
        const [subscriptionsResult, membersResult] = await Promise.all([
          supabase
            .from("tenant_subscriptions")
            .select("clinic_id, status, updated_at")
            .in("clinic_id", clinicIds),
          supabase.from("clinic_members").select("clinic_id, active").in("clinic_id", clinicIds),
        ]);

        if (subscriptionsResult.error) throw subscriptionsResult.error;
        if (membersResult.error) throw membersResult.error;

        subscriptions = subscriptionsResult.data || [];
        members = membersResult.data || [];
      }

      const statusMap = new Map<string, TenantStatus>();
      for (const item of subscriptions) {
        const status = parseTenantStatus(item.status);
        if (!status) continue;
        statusMap.set(String(item.clinic_id), status);
      }

      const totals = {
        clinics_total: clinicIds.length,
        active: 0,
        trialing: 0,
        past_due: 0,
        suspended: 0,
        cancelled: 0,
        blocked: 0,
        members_total: 0,
      };

      for (const clinic of clinics || []) {
        const status = statusMap.get(String(clinic.id)) || "active";
        if (status === "trialing") totals.trialing += 1;
        if (status === "active") totals.active += 1;
        if (status === "past_due") totals.past_due += 1;
        if (status === "suspended") totals.suspended += 1;
        if (status === "cancelled") totals.cancelled += 1;
        if (status === "suspended" || status === "cancelled") {
          totals.blocked += 1;
        }
      }

      totals.members_total = members.filter((member) => member.active !== false).length;

      const recentClinics = (clinics || []).slice(0, 8).map((clinic) => ({
        id: String(clinic.id),
        name: String(clinic.name || ""),
        created_at: String(clinic.created_at || ""),
        status: statusMap.get(String(clinic.id)) || "active",
      }));

      res.json({
        totals,
        recent_clinics: recentClinics,
      });
    } catch (error) {
      try {
        throwIfSuperadminSchemaMissing(error);
      } catch (mappedError) {
        handleRouteError(res, mappedError, "GET /api/superadmin/dashboard/overview");
        return;
      }
      handleRouteError(res, error, "GET /api/superadmin/dashboard/overview");
    }
  });

  app.get("/api/superadmin/clinics", async (req, res) => {
    const context = await requireSuperadminContext(req, res);
    if (!context) return;

    try {
      const queryText = String(req.query?.q || "")
        .trim()
        .toLowerCase();
      const limitRaw = Number(req.query?.limit || 50);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 300) : 50;

      const { data: clinicRows, error: clinicError } = await supabase
        .from("clinics")
        .select("id, name, owner_user_id, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (clinicError) throw clinicError;

      const clinics = clinicRows || [];
      const clinicIds = clinics.map((clinic) => String(clinic.id));
      const ownerIds = Array.from(new Set(clinics.map((clinic) => String(clinic.owner_user_id))));

      const [subscriptionsResult, membersResult, flagsResult] = await Promise.all([
        clinicIds.length > 0
          ? supabase
              .from("tenant_subscriptions")
              .select(
                "clinic_id, plan_code, status, billing_provider, asaas_customer_id, asaas_subscription_id, trial_ends_at, current_period_start, current_period_end, payment_grace_until, next_charge_at, blocked_at, suspended_reason, updated_at"
              )
              .in("clinic_id", clinicIds)
          : Promise.resolve({ data: [], error: null }),
        clinicIds.length > 0
          ? supabase
              .from("clinic_members")
              .select("clinic_id, role, active")
              .in("clinic_id", clinicIds)
          : Promise.resolve({ data: [], error: null }),
        clinicIds.length > 0
          ? supabase
              .from("tenant_feature_flags")
              .select("clinic_id, enabled")
              .in("clinic_id", clinicIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (subscriptionsResult.error) throw subscriptionsResult.error;
      if (membersResult.error) throw membersResult.error;
      if (flagsResult.error) throw flagsResult.error;

      const subscriptionMap = new Map<string, TenantSubscriptionRow>();
      for (const row of subscriptionsResult.data || []) {
        subscriptionMap.set(String(row.clinic_id), subscriptionToResponse(row as TenantSubscriptionRow));
      }

      const membersByClinic = new Map<
        string,
        {
          active_members: number;
          roles: Record<UserRole, number>;
        }
      >();
      for (const member of membersResult.data || []) {
        const clinicId = String(member.clinic_id || "");
        if (!clinicId) continue;
        const role = parseRole(member.role) || "secretary";
        const bucket = membersByClinic.get(clinicId) || {
          active_members: 0,
          roles: { admin: 0, professional: 0, secretary: 0 },
        };
        if (member.active !== false) {
          bucket.active_members += 1;
          bucket.roles[role] += 1;
        }
        membersByClinic.set(clinicId, bucket);
      }

      const flagsByClinic = new Map<string, { total: number; enabled: number }>();
      for (const flag of flagsResult.data || []) {
        const clinicId = String(flag.clinic_id || "");
        if (!clinicId) continue;
        const bucket = flagsByClinic.get(clinicId) || { total: 0, enabled: 0 };
        bucket.total += 1;
        if (flag.enabled === true) {
          bucket.enabled += 1;
        }
        flagsByClinic.set(clinicId, bucket);
      }

      const ownerMap = new Map<string, { email: string | null; full_name: string | null }>();
      await Promise.all(
        ownerIds.map(async (ownerUserId) => {
          const { data, error } = await supabase.auth.admin.getUserById(ownerUserId);
          if (error || !data?.user) {
            ownerMap.set(ownerUserId, { email: null, full_name: null });
            return;
          }
          ownerMap.set(ownerUserId, {
            email: data.user.email || null,
            full_name: (data.user.user_metadata?.full_name as string | undefined) || null,
          });
        })
      );

      const mapped = clinics
        .map((clinic) => {
          const clinicId = String(clinic.id);
          const subscription = subscriptionMap.get(clinicId) || subscriptionToResponse({ clinic_id: clinicId });
          const membersSummary = membersByClinic.get(clinicId) || {
            active_members: 0,
            roles: { admin: 0, professional: 0, secretary: 0 },
          };
          const flagsSummary = flagsByClinic.get(clinicId) || { total: 0, enabled: 0 };
          const owner = ownerMap.get(String(clinic.owner_user_id)) || {
            email: null,
            full_name: null,
          };

          return {
            id: clinicId,
            name: String(clinic.name || ""),
            created_at: String(clinic.created_at || ""),
            owner_user_id: String(clinic.owner_user_id || ""),
            owner_email: owner.email,
            owner_full_name: owner.full_name,
            subscription,
            members: membersSummary,
            features: {
              enabled_count: flagsSummary.enabled,
              total_count: flagsSummary.total,
            },
          };
        })
        .filter((clinic) => {
          if (!queryText) return true;
          const haystack = `${clinic.name} ${clinic.owner_email || ""} ${clinic.owner_full_name || ""}`.toLowerCase();
          return haystack.includes(queryText);
        });

      res.json({
        clinics: mapped,
      });
    } catch (error) {
      try {
        throwIfSuperadminSchemaMissing(error);
      } catch (mappedError) {
        handleRouteError(res, mappedError, "GET /api/superadmin/clinics");
        return;
      }
      handleRouteError(res, error, "GET /api/superadmin/clinics");
    }
  });

  app.patch("/api/superadmin/clinics/:clinicId/subscription", async (req, res) => {
    const context = await requireSuperadminContext(req, res);
    if (!context) return;

    const clinicId = toUuidOrNull(req.params.clinicId);
    if (!clinicId) {
      res.status(400).json({ error: "clinicId invalido." });
      return;
    }

    try {
      await ensureClinicExistsOrThrow(clinicId);

      const incomingStatus =
        req.body?.status === undefined ? undefined : parseTenantStatus(req.body?.status);
      if (req.body?.status !== undefined && !incomingStatus) {
        res.status(400).json({
          error: "status deve ser trialing, active, past_due, suspended ou cancelled.",
        });
        return;
      }

      const incomingProvider =
        req.body?.billing_provider === undefined
          ? undefined
          : parseBillingProvider(req.body?.billing_provider);
      if (req.body?.billing_provider !== undefined && !incomingProvider) {
        res.status(400).json({ error: "billing_provider deve ser manual ou asaas." });
        return;
      }

      const nowIso = new Date().toISOString();
      const { data: current, error: currentError } = await supabase
        .from("tenant_subscriptions")
        .select(
          "clinic_id, plan_code, status, billing_provider, asaas_customer_id, asaas_subscription_id, trial_ends_at, current_period_start, current_period_end, payment_grace_until, next_charge_at, blocked_at, suspended_reason, metadata, updated_at"
        )
        .eq("clinic_id", clinicId)
        .maybeSingle();
      if (currentError) throw currentError;

      const nextStatus = incomingStatus || parseTenantStatus(current?.status) || "active";
      const nextProvider =
        incomingProvider || parseBillingProvider(current?.billing_provider) || "manual";

      const trialEndsAt = parseOptionalDateTimeInput(req.body?.trial_ends_at, "trial_ends_at");
      const periodStart = parseOptionalDateTimeInput(
        req.body?.current_period_start,
        "current_period_start"
      );
      const periodEnd = parseOptionalDateTimeInput(req.body?.current_period_end, "current_period_end");
      const graceUntil = parseOptionalDateTimeInput(
        req.body?.payment_grace_until,
        "payment_grace_until"
      );
      const nextChargeAt = parseOptionalDateTimeInput(req.body?.next_charge_at, "next_charge_at");

      const suspendedReason =
        req.body?.suspended_reason === undefined
          ? toNullableString(current?.suspended_reason)
          : toNullableString(req.body?.suspended_reason);

      const blockedAt =
        nextStatus === "suspended" || nextStatus === "cancelled"
          ? toNullableString(current?.blocked_at) || nowIso
          : null;

      const upsertPayload = {
        clinic_id: clinicId,
        plan_code: toNullableString(req.body?.plan_code) || toNullableString(current?.plan_code) || "starter",
        status: nextStatus,
        billing_provider: nextProvider,
        asaas_customer_id:
          req.body?.asaas_customer_id === undefined
            ? toNullableString(current?.asaas_customer_id)
            : toNullableString(req.body?.asaas_customer_id),
        asaas_subscription_id:
          req.body?.asaas_subscription_id === undefined
            ? toNullableString(current?.asaas_subscription_id)
            : toNullableString(req.body?.asaas_subscription_id),
        trial_ends_at:
          trialEndsAt === undefined ? toNullableString(current?.trial_ends_at) : trialEndsAt,
        current_period_start:
          periodStart === undefined ? toNullableString(current?.current_period_start) : periodStart,
        current_period_end:
          periodEnd === undefined ? toNullableString(current?.current_period_end) : periodEnd,
        payment_grace_until:
          graceUntil === undefined ? toNullableString(current?.payment_grace_until) : graceUntil,
        next_charge_at:
          nextChargeAt === undefined ? toNullableString(current?.next_charge_at) : nextChargeAt,
        blocked_at: blockedAt,
        suspended_reason: suspendedReason,
        metadata:
          req.body?.metadata && typeof req.body.metadata === "object"
            ? req.body.metadata
            : current?.metadata || {},
        updated_at: nowIso,
      };

      const { data: updated, error: updateError } = await supabase
        .from("tenant_subscriptions")
        .upsert(upsertPayload, { onConflict: "clinic_id" })
        .select(
          "clinic_id, plan_code, status, billing_provider, asaas_customer_id, asaas_subscription_id, trial_ends_at, current_period_start, current_period_end, payment_grace_until, next_charge_at, blocked_at, suspended_reason, updated_at"
        )
        .single();
      if (updateError) throw updateError;

      await registerPlatformAuditLog({
        actorUserId: context.userId,
        actorType: "superadmin",
        action: "tenant.subscription.updated",
        targetType: "clinic",
        targetId: clinicId,
        clinicId,
        metadata: {
          status: upsertPayload.status,
          plan_code: upsertPayload.plan_code,
          billing_provider: upsertPayload.billing_provider,
        },
      });

      res.json({
        subscription: subscriptionToResponse(updated as TenantSubscriptionRow),
      });
    } catch (error) {
      try {
        throwIfSuperadminSchemaMissing(error);
      } catch (mappedError) {
        handleRouteError(res, mappedError, "PATCH /api/superadmin/clinics/:clinicId/subscription");
        return;
      }
      handleRouteError(res, error, "PATCH /api/superadmin/clinics/:clinicId/subscription");
    }
  });

  app.post("/api/superadmin/clinics/:clinicId/asaas/sync-subscription", async (req, res) => {
    const context = await requireSuperadminContext(req, res);
    if (!context) return;

    const clinicId = toUuidOrNull(req.params.clinicId);
    if (!clinicId) {
      res.status(400).json({ error: "clinicId invalido." });
      return;
    }

    try {
      await ensureClinicExistsOrThrow(clinicId);
      const result = await syncTenantSubscriptionFromAsaas(clinicId);

      await registerPlatformAuditLog({
        actorUserId: context.userId,
        actorType: "superadmin",
        action: "tenant.subscription.synced_from_asaas",
        targetType: "clinic",
        targetId: clinicId,
        clinicId,
        metadata: {
          asaas_subscription_id: result.subscription.asaas_subscription_id,
          status: result.subscription.status,
        },
      });

      res.json(result);
    } catch (error) {
      try {
        throwIfSuperadminSchemaMissing(error);
      } catch (mappedError) {
        handleRouteError(
          res,
          mappedError,
          "POST /api/superadmin/clinics/:clinicId/asaas/sync-subscription"
        );
        return;
      }
      handleRouteError(res, error, "POST /api/superadmin/clinics/:clinicId/asaas/sync-subscription");
    }
  });

  app.get("/api/superadmin/clinics/:clinicId/features", async (req, res) => {
    const context = await requireSuperadminContext(req, res);
    if (!context) return;

    const clinicId = toUuidOrNull(req.params.clinicId);
    if (!clinicId) {
      res.status(400).json({ error: "clinicId invalido." });
      return;
    }

    try {
      await ensureClinicExistsOrThrow(clinicId);

      const { data, error } = await supabase
        .from("tenant_feature_flags")
        .select("id, clinic_id, feature_key, enabled, config, created_at, updated_at")
        .eq("clinic_id", clinicId)
        .order("feature_key", { ascending: true });
      if (error) throw error;

      const byKey = new Map<string, Record<string, unknown>>();
      for (const item of data || []) {
        byKey.set(String(item.feature_key || ""), item);
      }

      const allKeys = Array.from(
        new Set([
          ...defaultSuperadminFeatureKeys,
          ...(data || []).map((item) => String(item.feature_key || "")),
        ])
      ).filter(Boolean);

      const features = allKeys.map((featureKey) => {
        const saved = byKey.get(featureKey);
        return {
          clinic_id: clinicId,
          feature_key: featureKey,
          enabled: saved?.enabled === true,
          config: (saved?.config as Record<string, unknown> | undefined) || {},
          updated_at: toNullableString(saved?.updated_at),
        };
      });

      res.json({ features });
    } catch (error) {
      try {
        throwIfSuperadminSchemaMissing(error);
      } catch (mappedError) {
        handleRouteError(res, mappedError, "GET /api/superadmin/clinics/:clinicId/features");
        return;
      }
      handleRouteError(res, error, "GET /api/superadmin/clinics/:clinicId/features");
    }
  });

  app.put("/api/superadmin/clinics/:clinicId/features/:featureKey", async (req, res) => {
    const context = await requireSuperadminContext(req, res);
    if (!context) return;

    const clinicId = toUuidOrNull(req.params.clinicId);
    if (!clinicId) {
      res.status(400).json({ error: "clinicId invalido." });
      return;
    }

    const featureKey = normalizeFeatureKey(req.params.featureKey);
    if (!featureKey) {
      res.status(400).json({ error: "featureKey invalido." });
      return;
    }

    if (typeof req.body?.enabled !== "boolean") {
      res.status(400).json({ error: "enabled deve ser boolean." });
      return;
    }

    if (req.body?.config !== undefined && (req.body?.config === null || typeof req.body?.config !== "object")) {
      res.status(400).json({ error: "config deve ser um objeto JSON." });
      return;
    }

    try {
      await ensureClinicExistsOrThrow(clinicId);
      const nowIso = new Date().toISOString();

      const { data: existing, error: existingError } = await supabase
        .from("tenant_feature_flags")
        .select("id, config")
        .eq("clinic_id", clinicId)
        .eq("feature_key", featureKey)
        .maybeSingle();
      if (existingError) throw existingError;

      const nextConfig =
        req.body?.config !== undefined
          ? (req.body.config as Record<string, unknown>)
          : ((existing?.config as Record<string, unknown> | undefined) || {});

      let saved: Record<string, unknown> | null = null;
      if (existing?.id) {
        const { data, error } = await supabase
          .from("tenant_feature_flags")
          .update({
            enabled: req.body.enabled,
            config: nextConfig,
            updated_at: nowIso,
          })
          .eq("id", existing.id)
          .select("clinic_id, feature_key, enabled, config, updated_at")
          .single();
        if (error) throw error;
        saved = data;
      } else {
        const { data, error } = await supabase
          .from("tenant_feature_flags")
          .insert({
            clinic_id: clinicId,
            feature_key: featureKey,
            enabled: req.body.enabled,
            config: nextConfig,
            updated_at: nowIso,
          })
          .select("clinic_id, feature_key, enabled, config, updated_at")
          .single();
        if (error) throw error;
        saved = data;
      }

      await registerPlatformAuditLog({
        actorUserId: context.userId,
        actorType: "superadmin",
        action: "tenant.feature.updated",
        targetType: "feature_flag",
        targetId: `${clinicId}:${featureKey}`,
        clinicId,
        metadata: {
          feature_key: featureKey,
          enabled: req.body.enabled,
        },
      });

      res.json({
        feature: {
          clinic_id: clinicId,
          feature_key: featureKey,
          enabled: saved?.enabled === true,
          config: (saved?.config as Record<string, unknown> | undefined) || {},
          updated_at: toNullableString(saved?.updated_at),
        },
      });
    } catch (error) {
      try {
        throwIfSuperadminSchemaMissing(error);
      } catch (mappedError) {
        handleRouteError(res, mappedError, "PUT /api/superadmin/clinics/:clinicId/features/:featureKey");
        return;
      }
      handleRouteError(res, error, "PUT /api/superadmin/clinics/:clinicId/features/:featureKey");
    }
  });

  app.delete("/api/superadmin/clinics/:clinicId/features/:featureKey", async (req, res) => {
    const context = await requireSuperadminContext(req, res);
    if (!context) return;

    const clinicId = toUuidOrNull(req.params.clinicId);
    if (!clinicId) {
      res.status(400).json({ error: "clinicId invalido." });
      return;
    }

    const featureKey = normalizeFeatureKey(req.params.featureKey);
    if (!featureKey) {
      res.status(400).json({ error: "featureKey invalido." });
      return;
    }

    try {
      await ensureClinicExistsOrThrow(clinicId);

      const { error } = await supabase
        .from("tenant_feature_flags")
        .delete()
        .eq("clinic_id", clinicId)
        .eq("feature_key", featureKey);
      if (error) throw error;

      await registerPlatformAuditLog({
        actorUserId: context.userId,
        actorType: "superadmin",
        action: "tenant.feature.deleted",
        targetType: "feature_flag",
        targetId: `${clinicId}:${featureKey}`,
        clinicId,
        metadata: {
          feature_key: featureKey,
        },
      });

      res.json({ success: true });
    } catch (error) {
      try {
        throwIfSuperadminSchemaMissing(error);
      } catch (mappedError) {
        handleRouteError(
          res,
          mappedError,
          "DELETE /api/superadmin/clinics/:clinicId/features/:featureKey"
        );
        return;
      }
      handleRouteError(res, error, "DELETE /api/superadmin/clinics/:clinicId/features/:featureKey");
    }
  });

  app.get("/api/superadmin/audit", async (req, res) => {
    const context = await requireSuperadminContext(req, res);
    if (!context) return;

    try {
      const limitRaw = Number(req.query?.limit || 100);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 300) : 100;
      const clinicId = toUuidOrNull(req.query?.clinic_id);

      let query = supabase
        .from("platform_audit_logs")
        .select("id, actor_user_id, actor_type, action, target_type, target_id, clinic_id, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (clinicId) {
        query = query.eq("clinic_id", clinicId);
      }

      const { data, error } = await query;
      if (error) throw error;

      res.json({
        logs: data || [],
      });
    } catch (error) {
      try {
        throwIfSuperadminSchemaMissing(error);
      } catch (mappedError) {
        handleRouteError(res, mappedError, "GET /api/superadmin/audit");
        return;
      }
      handleRouteError(res, error, "GET /api/superadmin/audit");
    }
  });

  app.get("/api/clinic/members", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    try {
      const { data, error } = await supabase
        .from("clinic_members")
        .select("id, clinic_id, user_id, role, active, created_at")
        .eq("clinic_id", context.clinicId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      const members = data ?? [];
      const userIds = Array.from(new Set(members.map((item) => item.user_id)));
      const userMap = new Map<string, { email: string | null; full_name: string | null }>();

      await Promise.all(
        userIds.map(async (userId) => {
          const { data: userData, error: userError } = await supabase.auth.admin.getUserById(
            userId
          );
          if (userError || !userData?.user) {
            userMap.set(userId, { email: null, full_name: null });
            return;
          }
          userMap.set(userId, {
            email: userData.user.email || null,
            full_name:
              (userData.user.user_metadata?.full_name as string | undefined) || null,
          });
        })
      );

      res.json(
        members.map((member) => ({
          ...member,
          email: userMap.get(member.user_id)?.email ?? null,
          full_name: userMap.get(member.user_id)?.full_name ?? null,
        }))
      );
    } catch (error) {
      handleRouteError(res, error, "GET /api/clinic/members");
    }
  });

  app.post("/api/clinic/members", async (req, res) => {
    const context = await requireUserContext(req, res, ["admin"]);
    if (!context) return;

    try {
      const role = parseRole(req.body?.role);
      if (!role) {
        res.status(400).json({ error: "role must be admin/professional/secretary" });
        return;
      }

      let targetUserId = toNullableString(req.body?.user_id);
      const email = toNullableString(req.body?.email);

      if (!targetUserId && email) {
        const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });
        if (usersError) throw usersError;

        const userList = (usersData?.users ?? []) as Array<{ id: string; email?: string | null }>;
        const found = userList.find(
          (item) => String(item.email || "").toLowerCase() === email.toLowerCase()
        );

        if (!found) {
          res.status(404).json({ error: "User email not found." });
          return;
        }
        targetUserId = found.id;
      }

      if (!targetUserId) {
        res.status(400).json({ error: "Provide user_id or email." });
        return;
      }

      const { error } = await supabase.from("clinic_members").upsert(
        {
          clinic_id: context.clinicId,
          user_id: targetUserId,
          role,
          active: true,
        },
        { onConflict: "clinic_id,user_id" }
      );

      if (error) throw error;
      res.status(201).json({ success: true });
    } catch (error) {
      handleRouteError(res, error, "POST /api/clinic/members");
    }
  });

  app.patch("/api/clinic/members/:id", async (req, res) => {
    const context = await requireUserContext(req, res, ["admin"]);
    if (!context) return;

    const memberId = toNullableNumber(req.params.id);
    if (memberId === null) {
      res.status(400).json({ error: "Invalid member id" });
      return;
    }

    try {
      const { data: current, error: currentError } = await supabase
        .from("clinic_members")
        .select("id, role, active")
        .eq("id", memberId)
        .eq("clinic_id", context.clinicId)
        .maybeSingle();

      if (currentError) throw currentError;
      if (!current) {
        res.status(404).json({ error: "Clinic member not found" });
        return;
      }

      const nextRole = parseRole(req.body?.role) || (current.role as UserRole);
      const nextActive = typeof req.body?.active === "boolean" ? req.body.active : current.active;

      if ((current.role === "admin" && nextRole !== "admin") || !nextActive) {
        const { count, error: countError } = await supabase
          .from("clinic_members")
          .select("id", { head: true, count: "exact" })
          .eq("clinic_id", context.clinicId)
          .eq("active", true)
          .eq("role", "admin");
        if (countError) throw countError;
        if ((count ?? 0) <= 1) {
          res.status(400).json({ error: "Clinic must keep at least one active admin." });
          return;
        }
      }

      const { error } = await supabase
        .from("clinic_members")
        .update({ role: nextRole, active: nextActive })
        .eq("id", memberId)
        .eq("clinic_id", context.clinicId);

      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      handleRouteError(res, error, "PATCH /api/clinic/members/:id");
    }
  });

  app.delete("/api/clinic/members/:id", async (req, res) => {
    const context = await requireUserContext(req, res, ["admin"]);
    if (!context) return;

    const memberId = toNullableNumber(req.params.id);
    if (memberId === null) {
      res.status(400).json({ error: "Invalid member id" });
      return;
    }

    try {
      const { data: current, error: currentError } = await supabase
        .from("clinic_members")
        .select("id, role")
        .eq("id", memberId)
        .eq("clinic_id", context.clinicId)
        .maybeSingle();

      if (currentError) throw currentError;
      if (!current) {
        res.status(404).json({ error: "Clinic member not found" });
        return;
      }

      if (current.role === "admin") {
        const { count, error: countError } = await supabase
          .from("clinic_members")
          .select("id", { head: true, count: "exact" })
          .eq("clinic_id", context.clinicId)
          .eq("active", true)
          .eq("role", "admin");
        if (countError) throw countError;
        if ((count ?? 0) <= 1) {
          res.status(400).json({ error: "Clinic must keep at least one active admin." });
          return;
        }
      }

      const { error } = await supabase
        .from("clinic_members")
        .delete()
        .eq("id", memberId)
        .eq("clinic_id", context.clinicId);

      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      handleRouteError(res, error, "DELETE /api/clinic/members/:id");
    }
  });

  app.get("/api/integrations/evolution/status", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    try {
      const connection = await getEvolutionConnection(context.clinicId);
      res.json(evolutionConnectionToResponse(connection));
    } catch (error) {
      try {
        throwIfEvolutionSchemaMissing(error);
      } catch (mappedError) {
        handleRouteError(res, mappedError, "GET /api/integrations/evolution/status");
        return;
      }
      handleRouteError(res, error, "GET /api/integrations/evolution/status");
    }
  });

  app.put("/api/integrations/evolution/settings", async (req, res) => {
    const context = await requireUserContext(req, res, ["admin", "professional"]);
    if (!context) return;

    try {
      const apiBaseUrl = ensureHttpUrl(req.body?.api_base_url, "api_base_url");
      const instanceName = toNullableString(req.body?.instance_name);
      if (!instanceName) {
        res.status(400).json({ error: "instance_name e obrigatorio." });
        return;
      }
      const apiToken = toNullableString(req.body?.api_token);
      const webhookSecret = toNullableString(req.body?.webhook_secret);

      const current = await getEvolutionConnection(context.clinicId);
      if (!current && !apiToken) {
        res.status(400).json({ error: "api_token e obrigatorio na primeira configuracao." });
        return;
      }

      const nowIso = new Date().toISOString();
      const nextTokenEncrypted = apiToken ? encryptSecret(apiToken) : current?.api_token_encrypted;
      if (!nextTokenEncrypted) {
        res.status(400).json({ error: "api_token nao configurado." });
        return;
      }

      const { data, error } = await supabase
        .from("clinic_evolution_connections")
        .upsert(
          {
            clinic_id: context.clinicId,
            api_base_url: apiBaseUrl,
            instance_name: instanceName,
            api_token_encrypted: nextTokenEncrypted,
            webhook_secret:
              webhookSecret !== null
                ? webhookSecret
                : toNullableString(current?.webhook_secret) || null,
            status: "connected",
            last_error: null,
            updated_at: nowIso,
            created_by_user_id: context.userId,
          },
          { onConflict: "clinic_id" }
        )
        .select(
          "clinic_id, api_base_url, instance_name, api_token_encrypted, webhook_secret, status, last_error, last_seen_at, metadata, updated_at"
        )
        .single();
      if (error) {
        throwIfEvolutionSchemaMissing(error);
        throw error;
      }

      res.json(evolutionConnectionToResponse(data as EvolutionConnectionRow));
    } catch (error) {
      try {
        throwIfEvolutionSchemaMissing(error);
      } catch (mappedError) {
        handleRouteError(res, mappedError, "PUT /api/integrations/evolution/settings");
        return;
      }
      handleRouteError(res, error, "PUT /api/integrations/evolution/settings");
    }
  });

  app.post("/api/integrations/evolution/disconnect", async (req, res) => {
    const context = await requireUserContext(req, res, ["admin", "professional"]);
    if (!context) return;

    try {
      const { error } = await supabase
        .from("clinic_evolution_connections")
        .update({
          status: "disconnected",
          updated_at: new Date().toISOString(),
        })
        .eq("clinic_id", context.clinicId);
      if (error) {
        throwIfEvolutionSchemaMissing(error);
        throw error;
      }

      res.json({ success: true });
    } catch (error) {
      try {
        throwIfEvolutionSchemaMissing(error);
      } catch (mappedError) {
        handleRouteError(res, mappedError, "POST /api/integrations/evolution/disconnect");
        return;
      }
      handleRouteError(res, error, "POST /api/integrations/evolution/disconnect");
    }
  });

  app.post("/api/integrations/evolution/webhook", sensitiveLimiter, async (req, res) => {
    const clinicId = toUuidOrNull(
      req.query?.clinic_id || req.body?.clinic_id || req.body?.clinicId || req.header("x-clinic-id")
    );
    if (!clinicId) {
      res.status(400).json({ error: "clinic_id invalido no webhook." });
      return;
    }

    try {
      const connection = await getEvolutionConnection(clinicId);
      if (!connection) {
        res.status(404).json({ error: "Conexao Evolution nao encontrada para a clinica." });
        return;
      }

      const authHeader = String(req.header("authorization") || "");
      const authToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      const providedToken =
        toNullableString(req.header("x-evolution-token")) ||
        toNullableString(req.header("x-smartpsi-token")) ||
        authToken ||
        "";
      const expectedToken =
        toNullableString(connection.webhook_secret) || toNullableString(evolutionWebhookToken) || "";
      if (expectedToken && providedToken !== expectedToken) {
        res.status(401).json({ error: "Token de webhook Evolution invalido." });
        return;
      }

      const payload = asRecord(req.body);
      const parsed = parseEvolutionWebhookMessage(payload);
      if (!parsed.externalThreadId) {
        res.status(202).json({ accepted: true, reason: "Webhook sem thread identificavel." });
        return;
      }

      const thread = await upsertInboxThreadFromWebhook(clinicId, parsed);
      const message = await insertInboxMessageIfMissing(clinicId, Number(thread.id), parsed);
      await markEvolutionConnectionHeartbeat(clinicId);

      res.json({
        success: true,
        event: parsed.eventName,
        thread_id: Number(thread.id),
        message_id: message ? Number(message.id) : null,
        duplicate: !message,
      });
    } catch (error) {
      try {
        throwIfEvolutionSchemaMissing(error);
      } catch (mappedError) {
        handleRouteError(res, mappedError, "POST /api/integrations/evolution/webhook");
        return;
      }
      handleRouteError(res, error, "POST /api/integrations/evolution/webhook");
    }
  });

  app.get("/api/inbox/threads", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    try {
      const statusFilter = parseInboxThreadStatus(req.query?.status);
      const queryText = String(req.query?.q || "")
        .trim()
        .toLowerCase();
      const assignedFilterRaw = toNullableString(req.query?.assigned);
      const limitRaw = Number(req.query?.limit || 120);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 300) : 120;

      let query = supabase
        .from("inbox_threads")
        .select(
          "id, clinic_id, channel, external_thread_id, contact_name, contact_phone, status, assigned_user_id, labels, unread_count, last_message_preview, last_message_at, metadata, created_at, updated_at"
        )
        .eq("clinic_id", context.clinicId)
        .limit(limit)
        .order("last_message_at", { ascending: false });
      if (statusFilter) {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query;
      if (error) {
        throwIfEvolutionSchemaMissing(error);
        throw error;
      }

      let threads = (data || []) as InboxThreadRow[];
      if (assignedFilterRaw === "me") {
        threads = threads.filter((thread) => toNullableString(thread.assigned_user_id) === context.userId);
      } else if (assignedFilterRaw === "unassigned") {
        threads = threads.filter((thread) => !toNullableString(thread.assigned_user_id));
      }

      if (queryText) {
        threads = threads.filter((thread) => {
          const haystack = `${thread.contact_name || ""} ${thread.contact_phone || ""} ${
            thread.last_message_preview || ""
          }`.toLowerCase();
          return haystack.includes(queryText);
        });
      }

      threads.sort((a, b) => {
        const aDate = new Date(a.last_message_at || a.updated_at || 0).getTime();
        const bDate = new Date(b.last_message_at || b.updated_at || 0).getTime();
        return bDate - aDate;
      });

      res.json({
        threads: threads.map((item) => inboxThreadToResponse(item)),
      });
    } catch (error) {
      try {
        throwIfEvolutionSchemaMissing(error);
      } catch (mappedError) {
        handleRouteError(res, mappedError, "GET /api/inbox/threads");
        return;
      }
      handleRouteError(res, error, "GET /api/inbox/threads");
    }
  });

  app.get("/api/inbox/threads/:threadId/messages", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    const threadId = toNullableNumber(req.params.threadId);
    if (threadId === null) {
      res.status(400).json({ error: "threadId invalido." });
      return;
    }

    try {
      const [threadResult, messagesResult] = await Promise.all([
        supabase
          .from("inbox_threads")
          .select(
            "id, clinic_id, channel, external_thread_id, contact_name, contact_phone, status, assigned_user_id, labels, unread_count, last_message_preview, last_message_at, metadata, created_at, updated_at"
          )
          .eq("clinic_id", context.clinicId)
          .eq("id", threadId)
          .maybeSingle(),
        supabase
          .from("inbox_messages")
          .select(
            "id, clinic_id, thread_id, direction, message_type, content, external_message_id, sender_name, sender_phone, sent_by_user_id, sent_at, status, payload, created_at"
          )
          .eq("clinic_id", context.clinicId)
          .eq("thread_id", threadId)
          .order("sent_at", { ascending: true })
          .limit(500),
      ]);

      if (threadResult.error) {
        throwIfEvolutionSchemaMissing(threadResult.error);
        throw threadResult.error;
      }
      if (!threadResult.data) {
        res.status(404).json({ error: "Thread nao encontrada." });
        return;
      }
      if (messagesResult.error) {
        throwIfEvolutionSchemaMissing(messagesResult.error);
        throw messagesResult.error;
      }

      res.json({
        thread: inboxThreadToResponse(threadResult.data as InboxThreadRow),
        messages: (messagesResult.data || []).map((item) =>
          inboxMessageToResponse(item as InboxMessageRow)
        ),
      });
    } catch (error) {
      try {
        throwIfEvolutionSchemaMissing(error);
      } catch (mappedError) {
        handleRouteError(res, mappedError, "GET /api/inbox/threads/:threadId/messages");
        return;
      }
      handleRouteError(res, error, "GET /api/inbox/threads/:threadId/messages");
    }
  });

  app.patch("/api/inbox/threads/:threadId", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    const threadId = toNullableNumber(req.params.threadId);
    if (threadId === null) {
      res.status(400).json({ error: "threadId invalido." });
      return;
    }

    try {
      const { data: current, error: currentError } = await supabase
        .from("inbox_threads")
        .select(
          "id, clinic_id, channel, external_thread_id, contact_name, contact_phone, status, assigned_user_id, labels, unread_count, last_message_preview, last_message_at, metadata, created_at, updated_at"
        )
        .eq("clinic_id", context.clinicId)
        .eq("id", threadId)
        .maybeSingle();
      if (currentError) {
        throwIfEvolutionSchemaMissing(currentError);
        throw currentError;
      }
      if (!current) {
        res.status(404).json({ error: "Thread nao encontrada." });
        return;
      }

      const nextStatus =
        req.body?.status !== undefined
          ? parseInboxThreadStatus(req.body?.status)
          : parseInboxThreadStatus(current.status);
      if (req.body?.status !== undefined && !nextStatus) {
        res.status(400).json({ error: "status invalido." });
        return;
      }

      let assignedUserId: string | null | undefined = undefined;
      if (req.body?.assigned_user_id !== undefined) {
        if (req.body?.assigned_user_id === null || req.body?.assigned_user_id === "") {
          assignedUserId = null;
        } else {
          const parsedUserId = toUuidOrNull(req.body?.assigned_user_id);
          if (!parsedUserId) {
            res.status(400).json({ error: "assigned_user_id invalido." });
            return;
          }
          await assertUserBelongsClinic(context.clinicId, parsedUserId);
          assignedUserId = parsedUserId;
        }
      }

      const nextLabels =
        req.body?.labels !== undefined ? normalizeInboxLabels(req.body?.labels) : parseLabelsJson(current.labels);
      const { data: updated, error: updateError } = await supabase
        .from("inbox_threads")
        .update({
          status: nextStatus || "open",
          assigned_user_id:
            assignedUserId === undefined ? toNullableString(current.assigned_user_id) : assignedUserId,
          labels: nextLabels,
          updated_at: new Date().toISOString(),
        })
        .eq("clinic_id", context.clinicId)
        .eq("id", threadId)
        .select(
          "id, clinic_id, channel, external_thread_id, contact_name, contact_phone, status, assigned_user_id, labels, unread_count, last_message_preview, last_message_at, metadata, created_at, updated_at"
        )
        .single();
      if (updateError) {
        throwIfEvolutionSchemaMissing(updateError);
        throw updateError;
      }

      res.json({
        thread: inboxThreadToResponse(updated as InboxThreadRow),
      });
    } catch (error) {
      try {
        throwIfEvolutionSchemaMissing(error);
      } catch (mappedError) {
        handleRouteError(res, mappedError, "PATCH /api/inbox/threads/:threadId");
        return;
      }
      handleRouteError(res, error, "PATCH /api/inbox/threads/:threadId");
    }
  });

  app.post("/api/inbox/threads/:threadId/read", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    const threadId = toNullableNumber(req.params.threadId);
    if (threadId === null) {
      res.status(400).json({ error: "threadId invalido." });
      return;
    }

    try {
      const { data, error } = await supabase
        .from("inbox_threads")
        .update({
          unread_count: 0,
          updated_at: new Date().toISOString(),
        })
        .eq("clinic_id", context.clinicId)
        .eq("id", threadId)
        .select(
          "id, clinic_id, channel, external_thread_id, contact_name, contact_phone, status, assigned_user_id, labels, unread_count, last_message_preview, last_message_at, metadata, created_at, updated_at"
        )
        .single();
      if (error) {
        throwIfEvolutionSchemaMissing(error);
        throw error;
      }

      res.json({
        success: true,
        thread: inboxThreadToResponse(data as InboxThreadRow),
      });
    } catch (error) {
      try {
        throwIfEvolutionSchemaMissing(error);
      } catch (mappedError) {
        handleRouteError(res, mappedError, "POST /api/inbox/threads/:threadId/read");
        return;
      }
      handleRouteError(res, error, "POST /api/inbox/threads/:threadId/read");
    }
  });

  app.post("/api/inbox/threads/:threadId/messages", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    const threadId = toNullableNumber(req.params.threadId);
    if (threadId === null) {
      res.status(400).json({ error: "threadId invalido." });
      return;
    }

    const content = toNullableString(req.body?.content);
    if (!content) {
      res.status(400).json({ error: "content e obrigatorio." });
      return;
    }

    try {
      const [{ data: thread, error: threadError }, connection] = await Promise.all([
        supabase
          .from("inbox_threads")
          .select(
            "id, clinic_id, channel, external_thread_id, contact_name, contact_phone, status, assigned_user_id, labels, unread_count, last_message_preview, last_message_at, metadata, created_at, updated_at"
          )
          .eq("clinic_id", context.clinicId)
          .eq("id", threadId)
          .maybeSingle(),
        getEvolutionConnection(context.clinicId),
      ]);
      if (threadError) {
        throwIfEvolutionSchemaMissing(threadError);
        throw threadError;
      }
      if (!thread) {
        res.status(404).json({ error: "Thread nao encontrada." });
        return;
      }
      if (!connection) {
        res.status(409).json({ error: "Conexao Evolution nao configurada para a clinica." });
        return;
      }

      const destination =
        toPhoneFromThreadId(thread.external_thread_id) ||
        toNullableString(thread.contact_phone) ||
        toNullableString(thread.external_thread_id);
      if (!destination) {
        res.status(400).json({ error: "Thread sem destino valido para envio." });
        return;
      }

      let providerPayload: Record<string, unknown> = {};
      let sendStatus = "sent";
      let providerError: unknown = null;
      try {
        providerPayload = await evolutionRequest(
          connection,
          `/message/sendText/${encodeURIComponent(connection.instance_name)}`,
          {
            method: "POST",
            body: JSON.stringify({
              number: destination,
              text: content,
              delay: 0,
            }),
          }
        );
        await markEvolutionConnectionHeartbeat(context.clinicId);
      } catch (error) {
        sendStatus = "failed";
        providerError = error;
        providerPayload = {
          error: error instanceof Error ? error.message : String(error),
        };
        await supabase
          .from("clinic_evolution_connections")
          .update({
            status: "error",
            last_error: error instanceof Error ? error.message : String(error),
            updated_at: new Date().toISOString(),
          })
          .eq("clinic_id", context.clinicId);
      }

      const externalMessageId =
        toNullableString(providerPayload?.key && asRecord(providerPayload.key).id) ||
        toNullableString(providerPayload?.id) ||
        null;
      const nowIso = new Date().toISOString();

      const [{ data: message, error: messageError }, { error: threadUpdateError }] = await Promise.all([
        supabase
          .from("inbox_messages")
          .insert({
            clinic_id: context.clinicId,
            thread_id: threadId,
            direction: "outbound",
            message_type: "text",
            content,
            external_message_id: externalMessageId,
            sender_name: null,
            sender_phone: null,
            sent_by_user_id: context.userId,
            sent_at: nowIso,
            status: sendStatus,
            payload: providerPayload,
          })
          .select(
            "id, clinic_id, thread_id, direction, message_type, content, external_message_id, sender_name, sender_phone, sent_by_user_id, sent_at, status, payload, created_at"
          )
          .single(),
        supabase
          .from("inbox_threads")
          .update({
            last_message_preview: content,
            last_message_at: nowIso,
            updated_at: nowIso,
          })
          .eq("clinic_id", context.clinicId)
          .eq("id", threadId),
      ]);
      if (messageError) {
        throwIfEvolutionSchemaMissing(messageError);
        throw messageError;
      }
      if (threadUpdateError) {
        throwIfEvolutionSchemaMissing(threadUpdateError);
        throw threadUpdateError;
      }

      if (providerError) {
        throw providerError;
      }

      res.status(201).json({
        message: inboxMessageToResponse(message as InboxMessageRow),
      });
    } catch (error) {
      try {
        throwIfEvolutionSchemaMissing(error);
      } catch (mappedError) {
        handleRouteError(res, mappedError, "POST /api/inbox/threads/:threadId/messages");
        return;
      }
      handleRouteError(res, error, "POST /api/inbox/threads/:threadId/messages");
    }
  });

  app.get("/api/integrations/google/status", async (req, res) => {
    const context = await requireUserContext(req, res, ["admin", "professional"]);
    if (!context) return;

    try {
      if (!featureGoogleEnabled) {
        res.json({
          configured: false,
          connected: false,
          feature_enabled: false,
          connection: null,
          watch: null,
        });
        return;
      }

      const { data, error } = await supabase
        .from("google_user_connections")
        .select("id, google_email, expires_at, active, updated_at")
        .eq("clinic_id", context.clinicId)
        .eq("user_id", context.userId)
        .eq("active", true)
        .maybeSingle();
      if (error) throw error;

      const { data: watchData, error: watchError } = await supabase
        .from("google_watch_channels")
        .select("id, expiration_at, active")
        .eq("clinic_id", context.clinicId)
        .eq("user_id", context.userId)
        .eq("active", true)
        .order("expiration_at", { ascending: false })
        .limit(1);
      if (watchError) throw watchError;

      res.json({
        configured: isGoogleConfigured(),
        connected: Boolean(data),
        connection: data || null,
        watch: watchData?.[0] || null,
      });
    } catch (error) {
      handleRouteError(res, error, "GET /api/integrations/google/status");
    }
  });

  app.post("/api/integrations/google/connect", sensitiveLimiter, async (req, res) => {
    const context = await requireUserContext(req, res, ["admin", "professional"]);
    if (!context) return;

    try {
      if (!isGoogleConfigured()) {
        throw new HttpError(
          503,
          "Google integration not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI."
        );
      }

      const state = signStatePayload({
        clinicId: context.clinicId,
        userId: context.userId,
        ts: Date.now(),
      });
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", googleClientId);
      url.searchParams.set("redirect_uri", googleRedirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set(
        "scope",
        [
          "openid",
          "email",
          "profile",
          "https://www.googleapis.com/auth/calendar",
        ].join(" ")
      );
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("include_granted_scopes", "true");
      url.searchParams.set("state", state);

      res.json({ url: url.toString() });
    } catch (error) {
      handleRouteError(res, error, "POST /api/integrations/google/connect");
    }
  });

  app.get("/api/integrations/google/callback", async (req, res) => {
    try {
      if (!isGoogleConfigured()) {
        throw new HttpError(503, "Google integration not configured.");
      }

      const stateRaw = toNullableString(req.query.state);
      const code = toNullableString(req.query.code);
      if (!stateRaw || !code) {
        throw new HttpError(400, "Missing oauth callback parameters.");
      }
      const state = verifySignedState(stateRaw);
      if (!state?.clinicId || !state?.userId || !state.ts) {
        throw new HttpError(400, "Invalid oauth state payload.");
      }
      if (Date.now() - Number(state.ts) > 10 * 60 * 1000) {
        throw new HttpError(400, "Expired oauth state.");
      }

      const { count, error: memberError } = await supabase
        .from("clinic_members")
        .select("id", { head: true, count: "exact" })
        .eq("clinic_id", state.clinicId)
        .eq("user_id", state.userId)
        .eq("active", true);
      if (memberError) throw memberError;
      if ((count ?? 0) <= 0) {
        throw new HttpError(403, "User is not an active clinic member.");
      }

      const token = await googleOAuthTokenRequest({
        code,
        client_id: googleClientId,
        client_secret: googleClientSecret,
        redirect_uri: googleRedirectUri,
        grant_type: "authorization_code",
      });

      const profile = await getGoogleUserProfile(token.access_token);
      const refreshToken = toNullableString(token.refresh_token);
      if (!refreshToken) {
        throw new HttpError(
          400,
          "Google did not return refresh token. Reconnect with consent prompt."
        );
      }
      const expiresAt = new Date(Date.now() + Number(token.expires_in || 3600) * 1000)
        .toISOString();

      const { error: upsertError } = await supabase
        .from("google_user_connections")
        .upsert(
          {
            clinic_id: state.clinicId,
            user_id: state.userId,
            google_email: toNullableString(profile.email),
            access_token_encrypted: encryptSecret(token.access_token),
            refresh_token_encrypted: encryptSecret(refreshToken),
            expires_at: expiresAt,
            active: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "clinic_id,user_id" }
        );
      if (upsertError) throw upsertError;

      const oauthContext: UserContext = {
        clinicId: state.clinicId,
        userId: state.userId,
        role: "professional",
      };
      try {
        await ensureGoogleWatchChannel(oauthContext, state.userId, token.access_token);
      } catch (watchError) {
        console.warn("[google callback watch setup]", watchError);
      }

      res
        .status(200)
        .send(
          "<html><body><h3>Google conectado com sucesso.</h3><script>setTimeout(()=>window.close(),1200)</script></body></html>"
        );
    } catch (error) {
      const message =
        error instanceof HttpError ? error.message : "Falha ao conectar Google Agenda.";
      const safeMessage = escapeHtml(message);
      res.status(error instanceof HttpError ? error.status : 500).send(
        `<html><body><h3>Erro na conexao Google</h3><p>${safeMessage}</p></body></html>`
      );
    }
  });

  app.post("/api/integrations/google/disconnect", async (req, res) => {
    const context = await requireUserContext(req, res, ["admin", "professional"]);
    if (!context) return;

    try {
      const token = await getValidGoogleAccessToken(context, context.userId);
      const { data: activeChannels, error: activeChannelsError } = await supabase
        .from("google_watch_channels")
        .select("channel_id, resource_id")
        .eq("clinic_id", context.clinicId)
        .eq("user_id", context.userId)
        .eq("active", true);
      if (activeChannelsError) throw activeChannelsError;
      if (token?.accessToken) {
        for (const channel of activeChannels ?? []) {
          const channelId = toNullableString(channel.channel_id);
          const resourceId = toNullableString(channel.resource_id);
          if (channelId && resourceId) {
            await stopGoogleWatchChannel(token.accessToken, channelId, resourceId);
          }
        }
      }

      await supabase
        .from("google_user_connections")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("clinic_id", context.clinicId)
        .eq("user_id", context.userId);
      await supabase
        .from("google_watch_channels")
        .update({ active: false })
        .eq("clinic_id", context.clinicId)
        .eq("user_id", context.userId);
      res.json({ success: true });
    } catch (error) {
      handleRouteError(res, error, "POST /api/integrations/google/disconnect");
    }
  });

  app.post("/api/integrations/google/resync", async (req, res) => {
    const context = await requireUserContext(req, res, ["admin", "professional"]);
    if (!context) return;

    try {
      const providerUserId = toNullableString(req.body?.provider_user_id) || context.userId;
      const token = await ensureGoogleConnectionForContext(context, providerUserId);
      try {
        await ensureGoogleWatchChannel(context, providerUserId, token.accessToken);
      } catch (watchError) {
        console.warn("[google resync watch setup]", watchError);
      }
      await importExternalGoogleEventsAsBlocks(context, providerUserId, token.accessToken);

      const { data: appointments, error: appointmentsError } = await supabase
        .from("appointments")
        .select("*")
        .eq("clinic_id", context.clinicId)
        .eq("provider_user_id", providerUserId)
        .gte("start_time", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .lte("start_time", new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString());
      if (appointmentsError) throw appointmentsError;

      const patientMap = await buildPatientNameMap(
        context.clinicId,
        (appointments ?? []).flatMap((item) => [
          toNullableNumber(item.patient_id),
          toNullableNumber(item.secondary_patient_id),
        ])
      );

      await Promise.all(
        (appointments ?? []).map((appointment) =>
          syncAppointmentToGoogle(
            context,
            appointment,
            patientMap.get(Number(appointment.patient_id)) || null,
            appointment.secondary_patient_id
              ? patientMap.get(Number(appointment.secondary_patient_id)) || null
              : null
          )
        )
      );

      res.json({ success: true, synced: appointments?.length || 0 });
    } catch (error) {
      handleRouteError(res, error, "POST /api/integrations/google/resync");
    }
  });

  app.post("/api/integrations/google/webhook", sensitiveLimiter, async (req, res) => {
    try {
      if (!featureGoogleEnabled) {
        res.status(503).json({ error: "Google feature is disabled." });
        return;
      }
      if (!googleWebhookToken) {
        res.status(503).json({ error: "Google webhook token is not configured." });
        return;
      }

      const tokenHeader = req.header("x-goog-channel-token") || "";
      if (tokenHeader !== googleWebhookToken) {
        res.status(401).json({ error: "Invalid webhook token" });
        return;
      }

      const channelId = toNullableString(req.header("x-goog-channel-id"));
      const resourceState = toNullableString(req.header("x-goog-resource-state")) || "unknown";
      if (!channelId) {
        res.status(202).json({ accepted: true, reason: "Missing channel id" });
        return;
      }

      const { data: watch, error: watchError } = await supabase
        .from("google_watch_channels")
        .select("*")
        .eq("channel_id", channelId)
        .eq("active", true)
        .maybeSingle();
      if (watchError) throw watchError;
      if (!watch) {
        res.status(202).json({ accepted: true, reason: "Unknown channel" });
        return;
      }

      const context: UserContext = {
        userId: String(watch.user_id),
        clinicId: String(watch.clinic_id),
        role: "professional",
      };
      const token = await ensureGoogleConnectionForContext(context, String(watch.user_id));
      await importExternalGoogleEventsAsBlocks(context, String(watch.user_id), token.accessToken);
      res.json({ success: true, resource_state: resourceState });
    } catch (error) {
      handleRouteError(res, error, "POST /api/integrations/google/webhook");
    }
  });

  app.get("/api/calendar/blocks", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    try {
      let query = supabase
        .from("calendar_blocks")
        .select("*")
        .eq("clinic_id", context.clinicId)
        .order("start_time", { ascending: true });

      const providerUserId = toNullableString(req.query.provider_user_id);
      if (providerUserId) query = query.eq("provider_user_id", providerUserId);

      const { data, error } = await query;
      if (error) throw error;

      const providerMap = await buildUserNameMap(
        (data ?? []).map((item) => String(item.provider_user_id))
      );

      res.json(
        (data ?? []).map((item) => ({
          ...item,
          provider_name: providerMap.get(String(item.provider_user_id)) || null,
        }))
      );
    } catch (error) {
      handleRouteError(res, error, "GET /api/calendar/blocks");
    }
  });

  app.delete("/api/calendar/blocks/:id", async (req, res) => {
    const context = await requireUserContext(req, res, ["admin", "professional"]);
    if (!context) return;

    const blockId = toNullableNumber(req.params.id);
    if (blockId === null) {
      res.status(400).json({ error: "Invalid block id" });
      return;
    }

    try {
      const { data: block, error: blockError } = await supabase
        .from("calendar_blocks")
        .select("*")
        .eq("clinic_id", context.clinicId)
        .eq("id", blockId)
        .maybeSingle();
      if (blockError) throw blockError;
      if (!block) {
        res.status(404).json({ error: "Block not found" });
        return;
      }

      if (block.google_event_id) {
        const token = await getValidGoogleAccessToken(
          context,
          String(block.provider_user_id)
        );
        if (token) {
          try {
            await googleFetch(
              token.accessToken,
              `/calendar/v3/calendars/${encodeURIComponent("primary")}/events/${encodeURIComponent(
                String(block.google_event_id)
              )}`,
              { method: "DELETE" }
            );
          } catch (error) {
            console.error("[delete calendar block google event]", error);
          }
        }
      }

      const { error } = await supabase
        .from("calendar_blocks")
        .delete()
        .eq("clinic_id", context.clinicId)
        .eq("id", blockId);
      if (error) throw error;

      res.json({ success: true });
    } catch (error) {
      handleRouteError(res, error, "DELETE /api/calendar/blocks/:id");
    }
  });

  app.post("/api/ai/process-audio", sensitiveLimiter, async (req, res) => {
    const context = await requireUserContext(req, res, ["admin", "professional"]);
    if (!context) return;

    const audioBase64 = toNullableString(req.body?.audioBase64);
    const mimeType = toNullableString(req.body?.mimeType);
    const patientId = toNullableNumber(req.body?.patient_id);
    const preferences = normalizeNotePreferences(req.body?.preferences);

    if (!audioBase64 || !mimeType) {
      res.status(400).json({ error: "audioBase64 and mimeType are required" });
      return;
    }

    let audioBytes = 0;
    try {
      audioBytes = Buffer.from(audioBase64, "base64").byteLength;
    } catch {
      res.status(400).json({ error: "Invalid audioBase64 payload" });
      return;
    }
    if (audioBytes <= 0) {
      res.status(400).json({ error: "Invalid audio payload" });
      return;
    }

    const requestId = toNullableString(String(res.getHeader("x-request-id") || ""));
    const fallbackMetrics = buildAiUsageMetrics({
      model: aiModelName,
      audioBytes,
      promptChars: 0,
      outputChars: 0,
    });
    let aiProcessingAttempted = false;

    try {
      if (patientId !== null) {
        await ensurePatientBelongsClinic(context.clinicId, patientId);
      }

      aiProcessingAttempted = true;
      const result = await processAudioToNote(audioBase64, mimeType, preferences, audioBytes);
      await registerAiUsageEvent({
        context,
        patientId,
        status: "success",
        metrics: result.metrics,
        requestId,
        metadata: {
          mime_type: mimeType,
        },
      });

      res.json({
        ...result.note,
        usage: {
          model: result.metrics.model,
          input_seconds: result.metrics.input_seconds,
          total_tokens_estimated: result.metrics.total_tokens_estimated,
          estimated_cost: result.metrics.estimated_cost,
          currency: result.metrics.currency,
        },
      });
    } catch (error) {
      if (aiProcessingAttempted) {
        await registerAiUsageEvent({
          context,
          patientId,
          status: "failed",
          metrics: fallbackMetrics,
          requestId,
          errorMessage: error instanceof Error ? error.message : String(error),
          metadata: {
            mime_type: mimeType,
          },
        });
      }
      handleRouteError(res, error, "POST /api/ai/process-audio");
    }
  });

  app.get("/api/ai/usage/summary", async (req, res) => {
    const context = await requireUserContext(req, res, ["admin", "professional"]);
    if (!context) return;

    const month = toNullableString(req.query.month) || new Date().toISOString().slice(0, 7);

    try {
      const { period, startIso, endIso } = resolveMonthRange(month);
      const { data, error } = await supabase
        .from("ai_usage_events")
        .select(
          "id, model, status, input_audio_bytes, input_seconds, input_tokens_estimated, output_tokens_estimated, total_tokens_estimated, estimated_cost, currency, created_at"
        )
        .eq("clinic_id", context.clinicId)
        .gte("created_at", startIso)
        .lt("created_at", endIso)
        .order("created_at", { ascending: true });

      if (error) {
        if (isMissingRelationError(error)) {
          res.status(503).json({
            error:
              "AI usage meter schema is not configured. Run migration 20260222_005_ai_usage_meter.sql.",
          });
          return;
        }
        throw error;
      }

      const rows = (data ?? []) as Array<Record<string, unknown>>;
      const totals = {
        requests: 0,
        success_count: 0,
        failed_count: 0,
        input_audio_bytes: 0,
        input_seconds: 0,
        input_minutes: 0,
        input_tokens_estimated: 0,
        output_tokens_estimated: 0,
        total_tokens_estimated: 0,
        estimated_cost: 0,
      };

      const byModelMap = new Map<
        string,
        {
          model: string;
          requests: number;
          success_count: number;
          failed_count: number;
          total_tokens_estimated: number;
          estimated_cost: number;
        }
      >();
      const byDayMap = new Map<
        string,
        {
          day: string;
          requests: number;
          success_count: number;
          failed_count: number;
          total_tokens_estimated: number;
          estimated_cost: number;
        }
      >();

      for (const row of rows) {
        const model = toNullableString(row.model) || aiModelName;
        const status: AiUsageStatus = toNullableString(row.status) === "failed" ? "failed" : "success";
        const createdAt = toNullableString(row.created_at) || new Date().toISOString();
        const day = createdAt.slice(0, 10);
        const inputAudioBytes = Math.max(0, Math.trunc(toNullableNumber(row.input_audio_bytes) || 0));
        const inputSeconds = Math.max(0, toNullableNumber(row.input_seconds) || 0);
        const inputTokens = Math.max(0, Math.trunc(toNullableNumber(row.input_tokens_estimated) || 0));
        const outputTokens = Math.max(0, Math.trunc(toNullableNumber(row.output_tokens_estimated) || 0));
        const totalTokens = Math.max(0, Math.trunc(toNullableNumber(row.total_tokens_estimated) || 0));
        const estimatedCost = Math.max(0, toNullableNumber(row.estimated_cost) || 0);

        totals.requests += 1;
        totals.success_count += status === "success" ? 1 : 0;
        totals.failed_count += status === "failed" ? 1 : 0;
        totals.input_audio_bytes += inputAudioBytes;
        totals.input_seconds += inputSeconds;
        totals.input_tokens_estimated += inputTokens;
        totals.output_tokens_estimated += outputTokens;
        totals.total_tokens_estimated += totalTokens;
        totals.estimated_cost += estimatedCost;

        const modelBucket = byModelMap.get(model) || {
          model,
          requests: 0,
          success_count: 0,
          failed_count: 0,
          total_tokens_estimated: 0,
          estimated_cost: 0,
        };
        modelBucket.requests += 1;
        modelBucket.success_count += status === "success" ? 1 : 0;
        modelBucket.failed_count += status === "failed" ? 1 : 0;
        modelBucket.total_tokens_estimated += totalTokens;
        modelBucket.estimated_cost += estimatedCost;
        byModelMap.set(model, modelBucket);

        const dayBucket = byDayMap.get(day) || {
          day,
          requests: 0,
          success_count: 0,
          failed_count: 0,
          total_tokens_estimated: 0,
          estimated_cost: 0,
        };
        dayBucket.requests += 1;
        dayBucket.success_count += status === "success" ? 1 : 0;
        dayBucket.failed_count += status === "failed" ? 1 : 0;
        dayBucket.total_tokens_estimated += totalTokens;
        dayBucket.estimated_cost += estimatedCost;
        byDayMap.set(day, dayBucket);
      }

      totals.input_minutes = roundNumber(totals.input_seconds / 60, 2);
      totals.input_seconds = roundNumber(totals.input_seconds, 2);
      totals.estimated_cost = roundNumber(totals.estimated_cost, 6);

      const byModel = Array.from(byModelMap.values())
        .map((item) => ({
          ...item,
          estimated_cost: roundNumber(item.estimated_cost, 6),
        }))
        .sort((a, b) => b.requests - a.requests);
      const byDay = Array.from(byDayMap.values())
        .map((item) => ({
          ...item,
          estimated_cost: roundNumber(item.estimated_cost, 6),
        }))
        .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

      const recent = rows
        .slice(-20)
        .reverse()
        .map((row) => ({
          id: toNullableNumber(row.id),
          model: toNullableString(row.model) || aiModelName,
          status: toNullableString(row.status) === "failed" ? "failed" : "success",
          created_at: toNullableString(row.created_at),
          total_tokens_estimated: Math.max(
            0,
            Math.trunc(toNullableNumber(row.total_tokens_estimated) || 0)
          ),
          estimated_cost: roundNumber(Math.max(0, toNullableNumber(row.estimated_cost) || 0), 6),
        }));

      res.json({
        period,
        pricing: {
          token_cost_per_million: normalizeFiniteNumber(aiTokenCostPerMillion, 0),
          audio_cost_per_minute: normalizeFiniteNumber(aiAudioCostPerMinute, 0),
          audio_tokens_per_minute: normalizeFiniteNumber(aiAudioTokensPerMinute, 900),
          currency: aiCostCurrency,
        },
        totals,
        by_model: byModel,
        by_day: byDay,
        recent,
      });
    } catch (error) {
      handleRouteError(res, error, "GET /api/ai/usage/summary");
    }
  });

  app.get("/api/stats", async (req, res) => {
    const context = await requireUserContext(req, res, ["admin", "professional"]);
    if (!context) return;

    try {
      const today = dayRangeUtc(0);
      const sessionsToday = await countNotesByRange(
        context.clinicId,
        today.startIso,
        today.endIso
      );
      const pendingReview = await countNotesByRange(
        context.clinicId,
        today.startIso,
        today.endIso,
        "draft"
      );

      const volumeData: Array<{ name: string; volume: number }> = [];
      for (let i = -6; i <= 0; i += 1) {
        const day = dayRangeUtc(i);
        const count = await countNotesByRange(context.clinicId, day.startIso, day.endIso);
        const dayName = day.date
          .toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" })
          .replace(".", "");
        volumeData.push({ name: dayName, volume: count });
      }

      res.json({
        sessionsToday,
        pendingReview,
        timeSaved: `${sessionsToday * 20}m`,
        avgProcessing: "1m 12s",
        volumeData,
      });
    } catch (error) {
      handleRouteError(res, error, "GET /api/stats");
    }
  });

  app.get("/api/appointments/next", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    try {
      const { data, error } = await supabase
        .from("appointments")
        .select("*")
        .eq("clinic_id", context.clinicId)
        .or("is_block.is.null,is_block.eq.false")
        .gt("start_time", new Date().toISOString())
        .in("status", ["scheduled"])
        .order("start_time", { ascending: true })
        .limit(1);

      if (error) throw error;

      const nextAppointment = data?.[0];
      if (!nextAppointment) {
        res.json(null);
        return;
      }

      const patientMap = await buildPatientNameMap(context.clinicId, [
        toNullableNumber(nextAppointment.patient_id),
      ]);

      res.json({
        ...nextAppointment,
        patient_name: patientMap.get(Number(nextAppointment.patient_id)) ?? null,
      });
    } catch (error) {
      handleRouteError(res, error, "GET /api/appointments/next");
    }
  });

  app.get("/api/patients/:id/history", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    const patientId = toNullableNumber(req.params.id);
    if (patientId === null) {
      res.status(400).json({ error: "Invalid patient id" });
      return;
    }

    try {
      await ensurePatientBelongsClinic(context.clinicId, patientId);

      const [appointmentsResult, financialResult, notesResult] = await Promise.all([
        supabase
          .from("appointments")
          .select("*")
          .eq("clinic_id", context.clinicId)
          .or(`patient_id.eq.${patientId},secondary_patient_id.eq.${patientId}`)
          .order("start_time", { ascending: false }),
        supabase
          .from("financial_records")
          .select("*")
          .eq("clinic_id", context.clinicId)
          .eq("patient_id", patientId)
          .order("date", { ascending: false }),
        context.role === "secretary"
          ? Promise.resolve({ data: [], error: null } as { data: any[]; error: null })
          : supabase
              .from("notes")
              .select("*")
              .eq("clinic_id", context.clinicId)
              .eq("patient_id", patientId)
              .order("created_at", { ascending: false }),
      ]);

      if (appointmentsResult.error) throw appointmentsResult.error;
      if (financialResult.error) throw financialResult.error;
      if (notesResult.error) throw notesResult.error;

      res.json({
        notes: notesResult.data ?? [],
        appointments: appointmentsResult.data ?? [],
        financial: financialResult.data ?? [],
      });
    } catch (error) {
      handleRouteError(res, error, "GET /api/patients/:id/history");
    }
  });

  app.get("/api/patients", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    try {
      const [{ data: patients, error: patientsError }, { data: appointments, error: appointmentsError }] =
        await Promise.all([
          supabase
            .from("patients")
            .select("*")
            .eq("clinic_id", context.clinicId)
            .order("name", { ascending: true }),
          supabase
            .from("appointments")
            .select("patient_id, secondary_patient_id")
            .eq("clinic_id", context.clinicId),
        ]);

      if (patientsError) throw patientsError;
      if (appointmentsError) throw appointmentsError;

      const sessionCounts = new Map<number, number>();
      for (const item of appointments ?? []) {
        const primary = toNullableNumber(item.patient_id);
        if (primary !== null) {
          sessionCounts.set(primary, (sessionCounts.get(primary) ?? 0) + 1);
        }
        const secondary = toNullableNumber(item.secondary_patient_id);
        if (secondary !== null) {
          sessionCounts.set(secondary, (sessionCounts.get(secondary) ?? 0) + 1);
        }
      }

      const response = (patients ?? []).map((patient) => ({
        ...patient,
        notes: context.role === "secretary" ? null : patient.notes,
        anamnese: context.role === "secretary" ? null : patient.anamnese,
        session_count: sessionCounts.get(Number(patient.id)) ?? 0,
      }));

      res.json(response);
    } catch (error) {
      handleRouteError(res, error, "GET /api/patients");
    }
  });

  app.post("/api/patients", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    const name = toNullableString(req.body?.name);
    if (!name) {
      res.status(400).json({ error: "Name is required" });
      return;
    }

    try {
      const { data, error } = await supabase
        .from("patients")
        .insert({
          clinic_id: context.clinicId,
          user_id: context.userId,
          name,
          email: toNullableString(req.body?.email),
          phone: toNullableString(req.body?.phone),
          birth_date: toNullableString(req.body?.birth_date),
          cpf: toNullableString(req.body?.cpf),
          address: toNullableString(req.body?.address),
          notes: context.role === "secretary" ? null : toNullableString(req.body?.notes),
          anamnese: context.role === "secretary" ? null : toNullableString(req.body?.anamnese),
          session_fee: toNullableNumber(req.body?.session_fee) || 0,
          billing_mode_override: normalizeBillingMode(req.body?.billing_mode_override),
        })
        .select("id")
        .single();

      if (error) throw error;
      if (isAsaasConfigured()) {
        try {
          await syncPatientAsaasCustomer(context, Number(data.id));
        } catch (syncError) {
          console.warn("[patient create asaas sync]", syncError);
        }
      }
      res.json({ id: data.id });
    } catch (error) {
      handleRouteError(res, error, "POST /api/patients");
    }
  });

  app.put("/api/patients/:id", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    const patientId = toNullableNumber(req.params.id);
    const name = toNullableString(req.body?.name);
    if (patientId === null) {
      res.status(400).json({ error: "Invalid patient id" });
      return;
    }

    if (!name) {
      res.status(400).json({ error: "Name is required" });
      return;
    }

    if (
      context.role === "secretary" &&
      (req.body?.notes !== undefined || req.body?.anamnese !== undefined)
    ) {
      res.status(403).json({ error: "Secretary cannot update clinical records." });
      return;
    }

    try {
      const { data, error } = await supabase
        .from("patients")
        .update({
          name,
          email: toNullableString(req.body?.email),
          phone: toNullableString(req.body?.phone),
          birth_date: toNullableString(req.body?.birth_date),
          cpf: toNullableString(req.body?.cpf),
          address: toNullableString(req.body?.address),
          notes:
            context.role === "secretary" ? undefined : toNullableString(req.body?.notes),
          anamnese:
            context.role === "secretary" ? undefined : toNullableString(req.body?.anamnese),
          session_fee: toNullableNumber(req.body?.session_fee) || 0,
          billing_mode_override: normalizeBillingMode(req.body?.billing_mode_override),
        })
        .eq("id", patientId)
        .eq("clinic_id", context.clinicId)
        .select("id")
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        res.status(404).json({ error: "Patient not found" });
        return;
      }
      res.json({ id: data.id });
    } catch (error) {
      handleRouteError(res, error, "PUT /api/patients/:id");
    }
  });

  app.delete("/api/patients/:id", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    const patientId = toNullableNumber(req.params.id);
    if (patientId === null) {
      res.status(400).json({ error: "Invalid patient id" });
      return;
    }

    try {
      const [
        { count: notesCount, error: notesCountError },
        { count: appointmentsCount, error: appointmentsCountError },
        { count: financialCount, error: financialCountError },
      ] = await Promise.all([
        supabase
          .from("notes")
          .select("id", { count: "exact", head: true })
          .eq("clinic_id", context.clinicId)
          .eq("patient_id", patientId),
        supabase
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("clinic_id", context.clinicId)
          .or(`patient_id.eq.${patientId},secondary_patient_id.eq.${patientId}`),
        supabase
          .from("financial_records")
          .select("id", { count: "exact", head: true })
          .eq("clinic_id", context.clinicId)
          .eq("patient_id", patientId),
      ]);

      if (notesCountError) throw notesCountError;
      if (appointmentsCountError) throw appointmentsCountError;
      if (financialCountError) throw financialCountError;

      if ((notesCount || 0) > 0 || (appointmentsCount || 0) > 0 || (financialCount || 0) > 0) {
        res.status(409).json({
          error:
            "Paciente possui registros vinculados (sessoes, prontuarios ou financeiro) e nao pode ser excluido.",
        });
        return;
      }

      const { error } = await supabase
        .from("patients")
        .delete()
        .eq("id", patientId)
        .eq("clinic_id", context.clinicId);

      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      handleRouteError(res, error, "DELETE /api/patients/:id");
    }
  });

  app.get("/api/appointments", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    try {
      const { data, error } = await supabase
        .from("appointments")
        .select("*")
        .eq("clinic_id", context.clinicId)
        .order("start_time", { ascending: true });

      if (error) throw error;

      const appointments = data ?? [];
      const patientMap = await buildPatientNameMap(
        context.clinicId,
        appointments.flatMap((item) => [
          toNullableNumber(item.patient_id),
          toNullableNumber(item.secondary_patient_id),
        ])
      );
      const providerMap = await buildUserNameMap(
        appointments.map((item) => String(item.provider_user_id || item.user_id || ""))
      );

      res.json(
        appointments.map((appointment) => ({
          ...appointment,
          patient_name: patientMap.get(Number(appointment.patient_id)) ?? null,
          secondary_patient_name: appointment.secondary_patient_id
            ? patientMap.get(Number(appointment.secondary_patient_id)) ?? null
            : null,
          provider_name:
            providerMap.get(
              String(appointment.provider_user_id || appointment.user_id || "")
            ) || null,
        }))
      );
    } catch (error) {
      handleRouteError(res, error, "GET /api/appointments");
    }
  });

  app.post("/api/appointments", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    const patientId = toNullableNumber(req.body?.patient_id);
    const providerUserId = toNullableString(req.body?.provider_user_id) || context.userId;
    const startTime = toDateTimeOrNull(req.body?.start_time);
    const status = normalizeAppointmentStatus(req.body?.status);
    const sessionType = normalizeSessionType(req.body?.session_type);
    const sessionMode = normalizeSessionMode(req.body?.session_mode);
    const secondaryPatientId = toNullableNumber(req.body?.secondary_patient_id);
    const recurrenceInput =
      req.body?.recurrence && typeof req.body.recurrence === "object"
        ? req.body.recurrence
        : null;
    const recurrenceFrequency = normalizeRecurrenceFrequency(recurrenceInput?.frequency);
    const recurrenceUntilDate = toDateOnly(recurrenceInput?.until_date);
    const onlineMeetingUrl = toNullableString(req.body?.online_meeting_url);

    if (patientId === null || !startTime) {
      res.status(400).json({ error: "patient_id and start_time are required" });
      return;
    }

    if (!status) {
      res.status(400).json({ error: "Invalid appointment status" });
      return;
    }

    if (!sessionType || !sessionMode) {
      res.status(400).json({ error: "Invalid session_type or session_mode" });
      return;
    }

    if (sessionType === "couple" && secondaryPatientId === null) {
      res.status(400).json({ error: "secondary_patient_id is required for couple session." });
      return;
    }
    if (secondaryPatientId !== null && secondaryPatientId === patientId) {
      res.status(400).json({ error: "secondary_patient_id must be different from patient_id." });
      return;
    }

    if (recurrenceInput && (!recurrenceFrequency || !recurrenceUntilDate)) {
      res.status(400).json({
        error:
          "recurrence requires frequency (weekly|biweekly|monthly) and until_date (YYYY-MM-DD).",
      });
      return;
    }

    try {
      await ensureProviderBelongsClinic(context.clinicId, providerUserId);
      await ensurePatientBelongsClinic(context.clinicId, patientId);
      if (secondaryPatientId !== null) {
        await ensurePatientBelongsClinic(context.clinicId, secondaryPatientId);
      }

      if (status === "scheduled") {
        await assertPatientCanSchedule(context, patientId);
      }

      const effectiveOnlineUrl = sessionMode === "online" ? onlineMeetingUrl : null;
      const createPayloadBase = {
        clinic_id: context.clinicId,
        user_id: context.userId,
        provider_user_id: providerUserId,
        patient_id: patientId,
        secondary_patient_id: sessionType === "couple" ? secondaryPatientId : null,
        session_type: sessionType,
        session_mode: sessionMode,
        online_meeting_url: effectiveOnlineUrl,
        notes: toNullableString(req.body?.notes),
        status,
        duration_minutes: 60,
      };

      if (!recurrenceInput) {
        const endTime = addMinutesToIso(startTime, 60);
        await assertProviderSlotAvailable(context, providerUserId, startTime, endTime);
        const { data, error } = await supabase
          .from("appointments")
          .insert({
            ...createPayloadBase,
            start_time: startTime,
            end_time: endTime,
            is_exception: false,
            series_id: null,
            series_sequence: null,
          })
          .select("id, start_time, patient_id")
          .single();

        if (error) throw error;
        const billingMode = await getEffectiveBillingMode(context, patientId);
        if (billingMode === "session") {
          await createAsaasChargeForAppointment(
            context,
            patientId,
            Number(data.id),
            String(data.start_time),
            "session"
          );
        }

        const primaryName =
          (
            await buildPatientNameMap(context.clinicId, [
              patientId,
              sessionType === "couple" ? secondaryPatientId : null,
            ])
          ).get(patientId) || null;
        const secondaryName =
          sessionType === "couple" && secondaryPatientId
            ? (
                await buildPatientNameMap(context.clinicId, [secondaryPatientId])
              ).get(secondaryPatientId) || null
            : null;
        const { data: createdAppointment, error: createdError } = await supabase
          .from("appointments")
          .select("*")
          .eq("clinic_id", context.clinicId)
          .eq("id", data.id)
          .single();
        if (createdError) throw createdError;
        await syncAppointmentToGoogle(context, createdAppointment, primaryName, secondaryName);

        res.status(201).json({ id: data.id });
        return;
      }

      const recurrenceDates = generateRecurrenceDates(
        startTime,
        recurrenceFrequency as RecurrenceFrequency,
        recurrenceUntilDate as string
      );

      for (const dateIso of recurrenceDates) {
        await assertProviderSlotAvailable(
          context,
          providerUserId,
          dateIso,
          addMinutesToIso(dateIso, 60)
        );
      }

      const { data: seriesData, error: seriesError } = await supabase
        .from("appointment_series")
        .insert({
          clinic_id: context.clinicId,
          created_by_user_id: context.userId,
          frequency: recurrenceFrequency,
          until_date: recurrenceUntilDate,
          template_start_time: startTime,
          session_type: sessionType,
          session_mode: sessionMode,
          online_meeting_url: effectiveOnlineUrl,
          notes: toNullableString(req.body?.notes),
          active: true,
        })
        .select("id")
        .single();

      if (seriesError) throw seriesError;

      const rows = recurrenceDates.map((dateIso, index) => ({
        ...createPayloadBase,
        start_time: dateIso,
        end_time: addMinutesToIso(dateIso, 60),
        series_id: seriesData.id,
        series_sequence: index + 1,
        is_exception: false,
      }));

      const { data: inserted, error: insertError } = await supabase
        .from("appointments")
        .insert(rows)
        .select("*");
      if (insertError) throw insertError;

      const billingMode = await getEffectiveBillingMode(context, patientId);
      if (billingMode === "session") {
        await Promise.all(
          (inserted ?? []).map((item) =>
            createAsaasChargeForAppointment(
              context,
              patientId,
              Number(item.id),
              String(item.start_time),
              "session"
            )
          )
        );
      }

      const patientMap = await buildPatientNameMap(
        context.clinicId,
        [patientId, sessionType === "couple" ? secondaryPatientId : null]
      );
      const primaryName = patientMap.get(patientId) || null;
      const secondaryName =
        sessionType === "couple" && secondaryPatientId
          ? patientMap.get(secondaryPatientId) || null
          : null;
      await Promise.all(
        (inserted ?? []).map((item) =>
          syncAppointmentToGoogle(context, item, primaryName, secondaryName)
        )
      );

      res.status(201).json({
        ids: (inserted ?? []).map((item) => Number(item.id)),
        series_id: seriesData.id,
      });
    } catch (error) {
      handleRouteError(res, error, "POST /api/appointments");
    }
  });

  app.patch("/api/appointments/:id", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    const appointmentId = toNullableNumber(req.params.id);
    if (appointmentId === null) {
      res.status(400).json({ error: "Invalid appointment id" });
      return;
    }

    const scope = normalizeApplyScope(req.body?.apply_scope);

    try {
      const { data: current, error: currentError } = await supabase
        .from("appointments")
        .select("*")
        .eq("id", appointmentId)
        .eq("clinic_id", context.clinicId)
        .maybeSingle();
      if (currentError) throw currentError;
      if (!current) {
        res.status(404).json({ error: "Appointment not found" });
        return;
      }

      const currentPatientId = Number(current.patient_id);
      const currentProviderUserId =
        toNullableString(current.provider_user_id) || toNullableString(current.user_id) || context.userId;
      const nextPatientId =
        req.body?.patient_id !== undefined
          ? toNullableNumber(req.body?.patient_id)
          : currentPatientId;
      const nextProviderUserId =
        req.body?.provider_user_id !== undefined
          ? toNullableString(req.body?.provider_user_id)
          : currentProviderUserId;
      const nextStartTime =
        req.body?.start_time !== undefined
          ? toDateTimeOrNull(req.body?.start_time)
          : String(current.start_time);
      const nextStatus =
        req.body?.status !== undefined
          ? normalizeAppointmentStatus(req.body?.status)
          : normalizeAppointmentStatus(current.status);
      const nextSessionType =
        req.body?.session_type !== undefined
          ? normalizeSessionType(req.body?.session_type)
          : normalizeSessionType(current.session_type);
      const nextSessionMode =
        req.body?.session_mode !== undefined
          ? normalizeSessionMode(req.body?.session_mode)
          : normalizeSessionMode(current.session_mode);
      const nextSecondaryPatientId =
        req.body?.secondary_patient_id !== undefined
          ? toNullableNumber(req.body?.secondary_patient_id)
          : toNullableNumber(current.secondary_patient_id);
      const nextNotes =
        req.body?.notes !== undefined ? toNullableString(req.body?.notes) : current.notes;
      const nextOnlineUrlRaw =
        req.body?.online_meeting_url !== undefined
          ? toNullableString(req.body?.online_meeting_url)
          : toNullableString(current.online_meeting_url);

      if (nextPatientId === null || !nextStartTime || !nextProviderUserId) {
        res.status(400).json({ error: "patient_id, provider_user_id and start_time are required." });
        return;
      }
      if (!nextStatus || !nextSessionType || !nextSessionMode) {
        res.status(400).json({ error: "Invalid status/session_type/session_mode." });
        return;
      }
      if (nextSessionType === "couple" && nextSecondaryPatientId === null) {
        res.status(400).json({ error: "secondary_patient_id is required for couple session." });
        return;
      }
      if (nextSecondaryPatientId !== null && nextSecondaryPatientId === nextPatientId) {
        res.status(400).json({ error: "secondary_patient_id must be different from patient_id." });
        return;
      }

      await ensureProviderBelongsClinic(context.clinicId, nextProviderUserId);
      await ensurePatientBelongsClinic(context.clinicId, nextPatientId);
      if (nextSecondaryPatientId !== null) {
        await ensurePatientBelongsClinic(context.clinicId, nextSecondaryPatientId);
      }
      if (nextStatus === "scheduled") {
        await assertPatientCanSchedule(context, nextPatientId);
      }

      const targetRows =
        (scope === "all" || scope === "following") && current.series_id
          ? await (async () => {
              const { data: seriesRows, error: seriesRowsError } = await supabase
                .from("appointments")
                .select("*")
                .eq("clinic_id", context.clinicId)
                .eq("series_id", current.series_id)
                .order("series_sequence", { ascending: true });
              if (seriesRowsError) throw seriesRowsError;
              if (scope === "following") {
                const currentSequence = Number(current.series_sequence || 0);
                return (seriesRows ?? []).filter(
                  (item) => Number(item.series_sequence || 0) >= currentSequence
                );
              }
              return seriesRows ?? [];
            })()
          : [current];

      const startShiftMs =
        req.body?.start_time !== undefined
          ? new Date(nextStartTime).getTime() - new Date(String(current.start_time)).getTime()
          : 0;
      const effectiveOnlineUrl = nextSessionMode === "online" ? nextOnlineUrlRaw : null;
      let assignedSeriesId: number | null = toNullableNumber(current.series_id);
      let sequenceStart = 1;
      const targetRowIds = targetRows
        .map((row) => toNullableNumber(row.id))
        .filter((id): id is number => id !== null);

      const recurrenceInput =
        req.body?.recurrence && typeof req.body.recurrence === "object"
          ? req.body.recurrence
          : null;
      const recurrenceFrequency = normalizeRecurrenceFrequency(recurrenceInput?.frequency);
      const recurrenceUntilDate = toDateOnly(recurrenceInput?.until_date);

      if (scope === "following" && current.series_id) {
        const { data: sourceSeries, error: sourceSeriesError } = await supabase
          .from("appointment_series")
          .select("*")
          .eq("id", current.series_id)
          .eq("clinic_id", context.clinicId)
          .maybeSingle();
        if (sourceSeriesError) throw sourceSeriesError;

        const { data: newSeries, error: newSeriesError } = await supabase
          .from("appointment_series")
          .insert({
            clinic_id: context.clinicId,
            created_by_user_id: context.userId,
            frequency: recurrenceFrequency || sourceSeries?.frequency || "weekly",
            until_date:
              recurrenceUntilDate ||
              toDateOnly(sourceSeries?.until_date) ||
              new Date(nextStartTime).toISOString().slice(0, 10),
            template_start_time: nextStartTime,
            session_type: nextSessionType,
            session_mode: nextSessionMode,
            online_meeting_url: effectiveOnlineUrl,
            notes: nextNotes,
            active: true,
          })
          .select("id")
          .single();
        if (newSeriesError) throw newSeriesError;

        assignedSeriesId = Number(newSeries.id);
        sequenceStart = 1;

        const previousDate = new Date(new Date(String(current.start_time)).getTime() - 86400000)
          .toISOString()
          .slice(0, 10);
        await supabase
          .from("appointment_series")
          .update({ until_date: previousDate })
          .eq("id", current.series_id)
          .eq("clinic_id", context.clinicId);
      }

      const updatedIds: number[] = [];
      for (let i = 0; i < targetRows.length; i += 1) {
        const row = targetRows[i];
        const currentStart = new Date(String(row.start_time)).getTime();
        const rowStartTime =
          req.body?.start_time !== undefined
            ? new Date(currentStart + startShiftMs).toISOString()
            : String(row.start_time);
        const rowEndTime = addMinutesToIso(rowStartTime, 60);

        await assertProviderSlotAvailable(context, nextProviderUserId, rowStartTime, rowEndTime, {
          excludeAppointmentIds: targetRowIds,
        });

        const payload = {
          provider_user_id: nextProviderUserId,
          patient_id: nextPatientId,
          secondary_patient_id: nextSessionType === "couple" ? nextSecondaryPatientId : null,
          start_time: rowStartTime,
          end_time: rowEndTime,
          notes: nextNotes,
          status: nextStatus,
          session_type: nextSessionType,
          session_mode: nextSessionMode,
          online_meeting_url: effectiveOnlineUrl,
          duration_minutes: 60,
          is_exception: scope === "single" ? Boolean(row.series_id) : false,
          series_id: scope === "single" ? row.series_id : assignedSeriesId,
          series_sequence:
            scope === "single"
              ? row.series_sequence
              : sequenceStart + i,
        };

        const { data: updated, error: updateError } = await supabase
          .from("appointments")
          .update(payload)
          .eq("id", row.id)
          .eq("clinic_id", context.clinicId)
          .select("id")
          .single();
        if (updateError) throw updateError;
        updatedIds.push(Number(updated.id));
      }

      if (scope === "all" && current.series_id) {
        await supabase
          .from("appointment_series")
          .update({
            frequency: recurrenceFrequency || undefined,
            until_date: recurrenceUntilDate || undefined,
            template_start_time: nextStartTime,
            session_type: nextSessionType,
            session_mode: nextSessionMode,
            online_meeting_url: effectiveOnlineUrl,
            notes: nextNotes,
            active: true,
          })
          .eq("id", current.series_id)
          .eq("clinic_id", context.clinicId);
      }

      const patientMap = await buildPatientNameMap(
        context.clinicId,
        [nextPatientId, nextSessionType === "couple" ? nextSecondaryPatientId : null]
      );
      const primaryName = patientMap.get(nextPatientId) || null;
      const secondaryName =
        nextSessionType === "couple" && nextSecondaryPatientId
          ? patientMap.get(nextSecondaryPatientId) || null
          : null;
      const { data: refreshRows, error: refreshRowsError } = await supabase
        .from("appointments")
        .select("*")
        .in("id", updatedIds)
        .eq("clinic_id", context.clinicId);
      if (refreshRowsError) throw refreshRowsError;

      if (nextStatus === "cancelled") {
        await cancelAsaasChargesForAppointments(context, updatedIds);
      }

      await Promise.all(
        (refreshRows ?? []).map((item) =>
          syncAppointmentToGoogle(context, item, primaryName, secondaryName)
        )
      );

      res.json({ ids: updatedIds, apply_scope: scope });
    } catch (error) {
      handleRouteError(res, error, "PATCH /api/appointments/:id");
    }
  });

  app.put("/api/appointments/:id", async (_req, res) => {
    res.status(405).json({
      error: "Use PATCH /api/appointments/:id with apply_scope=single|following|all.",
    });
  });

  app.delete("/api/appointments/:id", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    const appointmentId = toNullableNumber(req.params.id);
    if (appointmentId === null) {
      res.status(400).json({ error: "Invalid appointment id" });
      return;
    }

    const scope = normalizeApplyScope(req.query.scope);

    try {
      const { data: current, error: currentError } = await supabase
        .from("appointments")
        .select(
          "id, clinic_id, series_id, series_sequence, start_time, provider_user_id, user_id, google_event_id, google_calendar_id"
        )
        .eq("id", appointmentId)
        .eq("clinic_id", context.clinicId)
        .maybeSingle();
      if (currentError) throw currentError;
      if (!current) {
        res.status(404).json({ error: "Appointment not found" });
        return;
      }

      if (!current.series_id || scope === "single") {
        await deleteAppointmentFromGoogle(context, current);
        await cancelAsaasChargesForAppointments(context, [appointmentId]);
        const { error } = await supabase
          .from("appointments")
          .delete()
          .eq("id", appointmentId)
          .eq("clinic_id", context.clinicId);
        if (error) throw error;
        res.json({ success: true, scope: "single" });
        return;
      }

      if (scope === "all") {
        const { data: rowsForDelete, error: rowsForDeleteError } = await supabase
          .from("appointments")
          .select("*")
          .eq("clinic_id", context.clinicId)
          .eq("series_id", current.series_id);
        if (rowsForDeleteError) throw rowsForDeleteError;
        await Promise.all((rowsForDelete ?? []).map((row) => deleteAppointmentFromGoogle(context, row)));
        await cancelAsaasChargesForAppointments(
          context,
          (rowsForDelete ?? []).map((row) => Number(row.id))
        );

        const { error: deleteError } = await supabase
          .from("appointments")
          .delete()
          .eq("clinic_id", context.clinicId)
          .eq("series_id", current.series_id);
        if (deleteError) throw deleteError;

        await supabase
          .from("appointment_series")
          .update({ active: false })
          .eq("id", current.series_id)
          .eq("clinic_id", context.clinicId);
        res.json({ success: true, scope: "all" });
        return;
      }

      const currentSequence = Number(current.series_sequence || 0);
      const { data: followingRows, error: followingRowsError } = await supabase
        .from("appointments")
        .select("*")
        .eq("clinic_id", context.clinicId)
        .eq("series_id", current.series_id)
        .gte("series_sequence", currentSequence);
      if (followingRowsError) throw followingRowsError;
      await Promise.all((followingRows ?? []).map((row) => deleteAppointmentFromGoogle(context, row)));
      await cancelAsaasChargesForAppointments(
        context,
        (followingRows ?? []).map((row) => Number(row.id))
      );

      const { error: deleteFollowingError } = await supabase
        .from("appointments")
        .delete()
        .eq("clinic_id", context.clinicId)
        .eq("series_id", current.series_id)
        .gte("series_sequence", currentSequence);
      if (deleteFollowingError) throw deleteFollowingError;

      const previousDate = new Date(new Date(String(current.start_time)).getTime() - 86400000)
        .toISOString()
        .slice(0, 10);
      await supabase
        .from("appointment_series")
        .update({ until_date: previousDate })
        .eq("id", current.series_id)
        .eq("clinic_id", context.clinicId);

      res.json({ success: true, scope: "following" });
    } catch (error) {
      handleRouteError(res, error, "DELETE /api/appointments/:id");
    }
  });

  app.get("/api/financial/billing/settings", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    try {
      const settings = await getClinicBillingSettings(context.clinicId);
      res.json(settings);
    } catch (error) {
      handleRouteError(res, error, "GET /api/financial/billing/settings");
    }
  });

  app.patch("/api/financial/billing/settings", async (req, res) => {
    const context = await requireUserContext(req, res, ["admin", "professional"]);
    if (!context) return;

    try {
      const current = await getClinicBillingSettings(context.clinicId);
      const defaultBillingMode =
        normalizeBillingMode(req.body?.default_billing_mode) || current.default_billing_mode;
      const monthlyGenerationDayRaw = toNullableNumber(req.body?.monthly_generation_day);
      const monthlyGenerationDay =
        monthlyGenerationDayRaw && monthlyGenerationDayRaw >= 1 && monthlyGenerationDayRaw <= 28
          ? Math.trunc(monthlyGenerationDayRaw)
          : current.monthly_generation_day;

      const payload = {
        clinic_id: context.clinicId,
        default_billing_mode: defaultBillingMode,
        monthly_generation_day: monthlyGenerationDay,
        timezone: toNullableString(req.body?.timezone) || current.timezone,
        auto_generate_monthly:
          typeof req.body?.auto_generate_monthly === "boolean"
            ? req.body.auto_generate_monthly
            : current.auto_generate_monthly,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("clinic_billing_settings")
        .upsert(payload, { onConflict: "clinic_id" })
        .select("*")
        .single();
      if (error) throw error;
      res.json(data);
    } catch (error) {
      handleRouteError(res, error, "PATCH /api/financial/billing/settings");
    }
  });

  app.get("/api/financial/asaas/settings", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    try {
      const settings = await getClinicAsaasSettings(context.clinicId);
      res.json({
        configured: isAsaasConfigured(),
        settings,
      });
    } catch (error) {
      handleRouteError(res, error, "GET /api/financial/asaas/settings");
    }
  });

  app.patch("/api/financial/asaas/settings", async (req, res) => {
    const context = await requireUserContext(req, res, ["admin", "professional"]);
    if (!context) return;

    try {
      const current = await getClinicAsaasSettings(context.clinicId);
      const preset = normalizeGoogleReminderPreset(req.body?.reminder_preset);
      const defaultTimeline = buildReminderPresetTimeline(preset);
      const reminderTimeline =
        Array.isArray(req.body?.reminder_timeline) && req.body.reminder_timeline.length > 0
          ? req.body.reminder_timeline
          : defaultTimeline;
      const reminderChannels =
        Array.isArray(req.body?.reminder_channels) && req.body.reminder_channels.length > 0
          ? req.body.reminder_channels
          : current.reminder_channels;

      const payload = {
        clinic_id: context.clinicId,
        reminder_preset: preset,
        reminder_channels: reminderChannels,
        reminder_timeline: reminderTimeline,
        default_due_days: toNullableNumber(req.body?.default_due_days) || current.default_due_days,
        late_fee_percent:
          toNullableNumber(req.body?.late_fee_percent) ?? current.late_fee_percent,
        interest_percent:
          toNullableNumber(req.body?.interest_percent) ?? current.interest_percent,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("clinic_asaas_settings")
        .upsert(payload, { onConflict: "clinic_id" })
        .select("*")
        .single();
      if (error) throw error;
      res.json(data);
    } catch (error) {
      handleRouteError(res, error, "PATCH /api/financial/asaas/settings");
    }
  });

  app.get("/api/financial/patient/:patientId/terms", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    const patientId = toNullableNumber(req.params.patientId);
    if (patientId === null) {
      res.status(400).json({ error: "Invalid patient id" });
      return;
    }

    try {
      const terms = await getPatientFinancialTerms(context, patientId);
      res.json(terms);
    } catch (error) {
      handleRouteError(res, error, "GET /api/financial/patient/:patientId/terms");
    }
  });

  app.patch("/api/financial/patient/:patientId/terms", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    const patientId = toNullableNumber(req.params.patientId);
    if (patientId === null) {
      res.status(400).json({ error: "Invalid patient id" });
      return;
    }

    try {
      await ensurePatientBelongsClinic(context.clinicId, patientId);
      const sessionFee = toNullableNumber(req.body?.session_fee);
      const billingModeOverride =
        req.body?.billing_mode_override === null
          ? null
          : normalizeBillingMode(req.body?.billing_mode_override);

      const { data, error } = await supabase
        .from("patients")
        .update({
          session_fee: sessionFee ?? undefined,
          billing_mode_override: billingModeOverride,
        })
        .eq("clinic_id", context.clinicId)
        .eq("id", patientId)
        .select("id")
        .single();
      if (error) throw error;

      const terms = await getPatientFinancialTerms(context, patientId);
      res.json({ ...terms, updated: data.id });
    } catch (error) {
      handleRouteError(res, error, "PATCH /api/financial/patient/:patientId/terms");
    }
  });

  app.get("/api/financial/patient/:patientId/monthly-summary", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    const patientId = toNullableNumber(req.params.patientId);
    const month = toNullableString(req.query.month) || new Date().toISOString().slice(0, 7);
    if (patientId === null) {
      res.status(400).json({ error: "Invalid patient id" });
      return;
    }

    try {
      const summary = await computePatientMonthlySummary(context, patientId, month);
      res.json(summary);
    } catch (error) {
      handleRouteError(res, error, "GET /api/financial/patient/:patientId/monthly-summary");
    }
  });

  app.post("/api/financial/monthly/generate", async (req, res) => {
    const context = await requireUserContext(req, res, ["admin", "professional"]);
    if (!context) return;

    const month = toNullableString(req.query.month) || new Date().toISOString().slice(0, 7);
    const patientId = toNullableNumber(req.body?.patient_id);
    const force = req.body?.force === true;

    try {
      const result = await generateMonthlyStatementsForPeriod(context, month, {
        patientId: patientId ?? undefined,
        force,
      });
      res.json(result);
    } catch (error) {
      handleRouteError(res, error, "POST /api/financial/monthly/generate");
    }
  });

  app.post("/api/internal/jobs/monthly-billing", async (req, res) => {
    try {
      const token = req.header("x-job-token") || "";
      if (internalJobToken && token !== internalJobToken) {
        res.status(401).json({ error: "Invalid job token" });
        return;
      }

      if (!internalJobToken) {
        const context = await requireUserContext(req, res, ["admin"]);
        if (!context) return;
        const now = new Date();
        const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
        const month = previousMonth.toISOString().slice(0, 7);
        const result = await generateMonthlyStatementsForPeriod(context, month);
        res.json(result);
        return;
      }

      const clinicId = toNullableString(req.body?.clinic_id);
      const userId = toNullableString(req.body?.user_id);
      if (!clinicId || !userId) {
        res.status(400).json({ error: "clinic_id and user_id are required for job execution." });
        return;
      }
      const context: UserContext = {
        clinicId,
        userId,
        role: "admin",
      };
      const now = new Date();
      const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const month = previousMonth.toISOString().slice(0, 7);
      const result = await generateMonthlyStatementsForPeriod(context, month);
      res.json(result);
    } catch (error) {
      handleRouteError(res, error, "POST /api/internal/jobs/monthly-billing");
    }
  });

  app.get("/api/financial", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    try {
      const { data, error } = await supabase
        .from("financial_records")
        .select("*")
        .eq("clinic_id", context.clinicId)
        .order("date", { ascending: false });

      if (error) throw error;

      const records = data ?? [];
      const patientMap = await buildPatientNameMap(
        context.clinicId,
        records.map((item) => toNullableNumber(item.patient_id))
      );

      res.json(
        records.map((record) => ({
          ...record,
          patient_name: record.patient_id
            ? patientMap.get(Number(record.patient_id)) ?? null
            : null,
        }))
      );
    } catch (error) {
      handleRouteError(res, error, "GET /api/financial");
    }
  });

  app.post("/api/financial", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    const amount = toNullableNumber(req.body?.amount);
    if (amount === null) {
      res.status(400).json({ error: "Amount is required" });
      return;
    }
    if (amount <= 0) {
      res.status(400).json({ error: "Amount must be greater than zero" });
      return;
    }

    const type = toNullableString(req.body?.type);
    if (type !== "income" && type !== "expense") {
      res.status(400).json({ error: "Type must be income or expense" });
      return;
    }
    const status = normalizeFinancialStatus(req.body?.status);
    if (!status) {
      res.status(400).json({ error: "Invalid financial status" });
      return;
    }

    const parsedDate = toDateTimeOrNull(req.body?.date);
    const patientId = toNullableNumber(req.body?.patient_id);
    if (patientId === null) {
      res.status(400).json({ error: "patient_id is required for financial records" });
      return;
    }

    try {
      await ensurePatientBelongsClinic(context.clinicId, patientId);

      const { data, error } = await supabase
        .from("financial_records")
        .insert({
          clinic_id: context.clinicId,
          user_id: context.userId,
          patient_id: patientId,
          amount,
          type,
          category: toNullableString(req.body?.category),
          description: toNullableString(req.body?.description),
          date: parsedDate ?? new Date().toISOString(),
          status,
        })
        .select("id")
        .single();

      if (error) throw error;
      res.json({ id: data.id });
    } catch (error) {
      handleRouteError(res, error, "POST /api/financial");
    }
  });

  app.put("/api/financial/:id", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    const recordId = toNullableNumber(req.params.id);
    const amount = toNullableNumber(req.body?.amount);
    const type = toNullableString(req.body?.type);
    const status = normalizeFinancialStatus(req.body?.status);

    if (recordId === null) {
      res.status(400).json({ error: "Invalid financial record id" });
      return;
    }

    if (amount === null) {
      res.status(400).json({ error: "Amount is required" });
      return;
    }
    if (amount <= 0) {
      res.status(400).json({ error: "Amount must be greater than zero" });
      return;
    }

    if (type !== "income" && type !== "expense") {
      res.status(400).json({ error: "Type must be income or expense" });
      return;
    }
    if (!status) {
      res.status(400).json({ error: "Invalid financial status" });
      return;
    }

    const parsedDate = toDateTimeOrNull(req.body?.date);
    const patientId = toNullableNumber(req.body?.patient_id);
    if (patientId === null) {
      res.status(400).json({ error: "patient_id is required for financial records" });
      return;
    }

    try {
      await ensurePatientBelongsClinic(context.clinicId, patientId);

      const { data, error } = await supabase
        .from("financial_records")
        .update({
          patient_id: patientId,
          amount,
          type,
          category: toNullableString(req.body?.category),
          description: toNullableString(req.body?.description),
          date: parsedDate ?? new Date().toISOString(),
          status,
        })
        .eq("id", recordId)
        .eq("clinic_id", context.clinicId)
        .select("id")
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        res.status(404).json({ error: "Financial record not found" });
        return;
      }
      res.json({ id: data.id });
    } catch (error) {
      handleRouteError(res, error, "PUT /api/financial/:id");
    }
  });

  app.delete("/api/financial/:id", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    const recordId = toNullableNumber(req.params.id);
    if (recordId === null) {
      res.status(400).json({ error: "Invalid financial record id" });
      return;
    }

    try {
      const { error } = await supabase
        .from("financial_records")
        .delete()
        .eq("id", recordId)
        .eq("clinic_id", context.clinicId);

      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      handleRouteError(res, error, "DELETE /api/financial/:id");
    }
  });

  app.post("/api/financial/asaas/sync-patient/:patientId", async (req, res) => {
    const context = await requireUserContext(req, res, ["admin", "professional"]);
    if (!context) return;

    const patientId = toNullableNumber(req.params.patientId);
    if (patientId === null) {
      res.status(400).json({ error: "Invalid patient id" });
      return;
    }

    try {
      const result = await syncPatientAsaasCustomer(context, patientId);
      res.json({
        patient_id: patientId,
        asaas_customer_id: result.asaasCustomerId,
      });
    } catch (error) {
      handleRouteError(res, error, "POST /api/financial/asaas/sync-patient/:patientId");
    }
  });

  app.get("/api/financial/patient/:patientId/status", async (req, res) => {
    const context = await requireUserContext(req, res);
    if (!context) return;

    const patientId = toNullableNumber(req.params.patientId);
    if (patientId === null) {
      res.status(400).json({ error: "Invalid patient id" });
      return;
    }

    try {
      await ensurePatientBelongsClinic(context.clinicId, patientId);
      const status = await getPatientFinancialStatus(context, patientId);
      res.json(status);
    } catch (error) {
      handleRouteError(res, error, "GET /api/financial/patient/:patientId/status");
    }
  });

  app.post("/api/asaas/webhook", sensitiveLimiter, async (req, res) => {
    try {
      if (!featureAsaasEnabled) {
        res.status(503).json({ error: "Asaas feature is disabled." });
        return;
      }
      if (!asaasWebhookToken) {
        res.status(503).json({ error: "Asaas webhook token is not configured." });
        return;
      }
      const tokenHeader = req.header("asaas-access-token") || req.header("x-asaas-token") || "";
      if (tokenHeader !== asaasWebhookToken) {
        res.status(401).json({ error: "Invalid webhook token" });
        return;
      }

      const payload = req.body ?? {};
      const event = toNullableString(payload.event) || "unknown";
      const tenantReconcile = await reconcileTenantSubscriptionFromAsaasWebhook(
        payload as Record<string, unknown>,
        event
      );
      const payment = payload.payment && typeof payload.payment === "object" ? payload.payment : {};
      const chargeId = toNullableString(payment.id) || toNullableString(payload.id);
      const status = toNullableString(payment.status) || toNullableString(payload.status);
      const dueDate = toDateOnly(payment.dueDate || payment.due_date || payload.dueDate);

      if (!chargeId) {
        if (tenantReconcile.handled) {
          res.json({
            success: true,
            event,
            charge_synced: false,
            tenant_subscription: {
              clinic_id: tenantReconcile.clinicId,
              asaas_subscription_id: tenantReconcile.asaasSubscriptionId,
              status: tenantReconcile.status,
            },
          });
          return;
        }
        res.status(202).json({ accepted: true, reason: "Missing charge id" });
        return;
      }

      const { data: existing, error: existingError } = await supabase
        .from("asaas_charges")
        .select("*")
        .eq("asaas_charge_id", chargeId)
        .maybeSingle();
      if (existingError) throw existingError;

      if (!existing) {
        if (tenantReconcile.handled) {
          res.json({
            success: true,
            event,
            charge_id: chargeId,
            charge_synced: false,
            tenant_subscription: {
              clinic_id: tenantReconcile.clinicId,
              asaas_subscription_id: tenantReconcile.asaasSubscriptionId,
              status: tenantReconcile.status,
            },
          });
          return;
        }
        res.status(202).json({ accepted: true, reason: "Charge not tracked locally" });
        return;
      }

      const { error: updateError } = await supabase
        .from("asaas_charges")
        .update({
          status: status || existing.status || undefined,
          due_date: dueDate || undefined,
          last_payload: payload,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      if (updateError) throw updateError;

      await reconcileAsaasChargeToFinancialRecord(
        existing as AsaasChargeRow,
        payload as Record<string, unknown>,
        status || toNullableString(existing.status),
        dueDate || toNullableString(existing.due_date)
      );

      res.json({
        success: true,
        event,
        charge_id: chargeId,
        charge_synced: true,
        tenant_subscription: tenantReconcile.handled
          ? {
              clinic_id: tenantReconcile.clinicId,
              asaas_subscription_id: tenantReconcile.asaasSubscriptionId,
              status: tenantReconcile.status,
            }
          : null,
      });
    } catch (error) {
      handleRouteError(res, error, "POST /api/asaas/webhook");
    }
  });

  app.post("/api/notes", async (req, res) => {
    const context = await requireUserContext(req, res, ["admin", "professional"]);
    if (!context) return;

    const patientId = toNullableNumber(req.body?.patient_id);
    const complaint = toNullableString(req.body?.complaint);
    const intervention = toNullableString(req.body?.intervention);
    const nextFocus = toNullableString(req.body?.next_focus);
    const observations = toNullableString(req.body?.observations);
    const status = toNullableString(req.body?.status) === "final" ? "final" : "draft";
    const source = normalizeNoteSource(req.body?.source);

    if (patientId === null) {
      res.status(400).json({
        error: "patient_id is required for clinical notes.",
      });
      return;
    }

    if (
      status === "final" &&
      !validateFinalNotePayload(patientId, complaint, intervention, nextFocus)
    ) {
      res.status(400).json({
        error: "Final notes require patient_id, complaint, intervention and next_focus.",
      });
      return;
    }

    try {
      await ensurePatientBelongsClinic(context.clinicId, patientId);

      const { data, error } = await supabase
        .from("notes")
        .insert({
          clinic_id: context.clinicId,
          user_id: context.userId,
          patient_id: patientId,
          complaint,
          intervention,
          next_focus: nextFocus,
          observations,
          status,
          source,
        })
        .select("id")
        .single();

      if (error) throw error;
      res.json({ id: data.id });
    } catch (error) {
      handleRouteError(res, error, "POST /api/notes");
    }
  });

  app.put("/api/notes/:id", async (req, res) => {
    const context = await requireUserContext(req, res, ["admin", "professional"]);
    if (!context) return;

    const noteId = toNullableNumber(req.params.id);
    const patientId = toNullableNumber(req.body?.patient_id);
    const complaint = toNullableString(req.body?.complaint);
    const intervention = toNullableString(req.body?.intervention);
    const nextFocus = toNullableString(req.body?.next_focus);
    const observations = toNullableString(req.body?.observations);
    const status = toNullableString(req.body?.status) === "final" ? "final" : "draft";

    if (noteId === null) {
      res.status(400).json({ error: "Invalid note id" });
      return;
    }

    if (patientId === null) {
      res.status(400).json({ error: "patient_id is required for clinical notes." });
      return;
    }

    if (
      status === "final" &&
      !validateFinalNotePayload(patientId, complaint, intervention, nextFocus)
    ) {
      res.status(400).json({
        error: "Final notes require patient_id, complaint, intervention and next_focus.",
      });
      return;
    }

    try {
      const { data: currentNote, error: currentError } = await supabase
        .from("notes")
        .select("id, source")
        .eq("id", noteId)
        .eq("clinic_id", context.clinicId)
        .maybeSingle();
      if (currentError) throw currentError;
      if (!currentNote) {
        res.status(404).json({ error: "Note not found" });
        return;
      }

      const source =
        req.body?.source !== undefined
          ? normalizeNoteSource(req.body?.source)
          : normalizeNoteSource(currentNote.source);

      await ensurePatientBelongsClinic(context.clinicId, patientId);

      const { data, error } = await supabase
        .from("notes")
        .update({
          patient_id: patientId,
          complaint,
          intervention,
          next_focus: nextFocus,
          observations,
          status,
          source,
        })
        .eq("id", noteId)
        .eq("clinic_id", context.clinicId)
        .select("id")
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        res.status(404).json({ error: "Note not found" });
        return;
      }
      res.json({ id: data.id });
    } catch (error) {
      handleRouteError(res, error, "PUT /api/notes/:id");
    }
  });

  app.get("/api/notes", async (req, res) => {
    const context = await requireUserContext(req, res, ["admin", "professional"]);
    if (!context) return;

    try {
      const { data, error } = await supabase
        .from("notes")
        .select("*")
        .eq("clinic_id", context.clinicId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const notes = data ?? [];
      const patientMap = await buildPatientNameMap(
        context.clinicId,
        notes.map((item) => toNullableNumber(item.patient_id))
      );

      res.json(
        notes.map((note) => ({
          ...note,
          source: normalizeNoteSource(note.source),
          patient_name: note.patient_id ? patientMap.get(Number(note.patient_id)) ?? null : null,
        }))
      );
    } catch (error) {
      handleRouteError(res, error, "GET /api/notes");
    }
  });

  app.delete("/api/notes", async (req, res) => {
    const context = await requireUserContext(req, res, ["admin", "professional"]);
    if (!context) return;

    try {
      const { error } = await supabase
        .from("notes")
        .delete()
        .eq("clinic_id", context.clinicId);
      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      handleRouteError(res, error, "DELETE /api/notes");
    }
  });

  app.delete("/api/notes/:id", async (req, res) => {
    const context = await requireUserContext(req, res, ["admin", "professional"]);
    if (!context) return;

    const noteId = toNullableNumber(req.params.id);
    if (noteId === null) {
      res.status(400).json({ error: "Invalid note id" });
      return;
    }

    try {
      const { error } = await supabase
        .from("notes")
        .delete()
        .eq("id", noteId)
        .eq("clinic_id", context.clinicId);

      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      handleRouteError(res, error, "DELETE /api/notes/:id");
    }
  });

  if (includeFrontend) {
    if (process.env.NODE_ENV !== "production") {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      app.use(express.static(path.join(__dirname, "dist")));
      app.get("*", (_req, res) => {
        res.sendFile(path.join(__dirname, "dist", "index.html"));
      });
    }
  }

  return app;
}

async function startServer() {
  const app = await createApp({ includeFrontend: true });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === __filename
  : false;

if (isDirectRun) {
  startServer().catch((error) => {
    console.error("[startup_error]", error);
    process.exit(1);
  });
}


