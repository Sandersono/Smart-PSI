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
const appUrl = process.env.APP_URL || "http://localhost:3000";
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
type UserContext = {
  userId: string;
  clinicId: string;
  role: UserRole;
};
type AppointmentStatus = "scheduled" | "completed" | "cancelled";
type SessionType = "individual" | "couple";
type SessionMode = "in_person" | "online";
type RecurrenceFrequency = "weekly" | "biweekly" | "monthly";
type ApplyScope = "single" | "following" | "all";
type BillingMode = "session" | "monthly";
type NoteSource = "audio" | "quick" | "manual";
type GoogleReminderPreset = "light" | "standard" | "intense";

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
        "Database schema is outdated. Run migrations 20260221_002_clinic_rbac_agenda_asaas.sql, 20260221_003_google_agenda_notes_source.sql and 20260221_004_financial_monthly_asaas_settings.sql."
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

function toDateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
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

async function processAudioToNote(
  audioBase64: string,
  mimeType: string,
  preferences: AiNotePreferences
) {
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
    model: "gemini-2.5-flash",
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

  const parsed = JSON.parse(response.text || "{}");
  return {
    complaint: String(parsed.complaint || "Nao identificado - revisar"),
    intervention: String(parsed.intervention || "Nao identificado - revisar"),
    next_focus: String(parsed.next_focus || "Nao identificado - revisar"),
  };
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

type CreateAppOptions = {
  includeFrontend?: boolean;
};

export async function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const includeFrontend = options.includeFrontend ?? true;
  const defaultCorsOrigins = appUrl ? [appUrl] : [];
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
        callback(new Error("Origin not allowed by CORS"));
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
    const preferences = normalizeNotePreferences(req.body?.preferences);

    if (!audioBase64 || !mimeType) {
      res.status(400).json({ error: "audioBase64 and mimeType are required" });
      return;
    }

    try {
      const note = await processAudioToNote(audioBase64, mimeType, preferences);
      res.json(note);
    } catch (error) {
      handleRouteError(res, error, "POST /api/ai/process-audio");
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

    if (context.role === "secretary" && req.body?.notes !== undefined) {
      res.status(403).json({ error: "Secretary cannot update clinical notes." });
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

    try {
      if (patientId !== null) {
        await ensurePatientBelongsClinic(context.clinicId, patientId);
      }

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

    try {
      if (patientId !== null) {
        await ensurePatientBelongsClinic(context.clinicId, patientId);
      }

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
      const payment = payload.payment && typeof payload.payment === "object" ? payload.payment : {};
      const chargeId = toNullableString(payment.id) || toNullableString(payload.id);
      const status = toNullableString(payment.status) || toNullableString(payload.status);
      const dueDate = toDateOnly(payment.dueDate || payment.due_date || payload.dueDate);

      if (!chargeId) {
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

      res.json({ success: true, event, charge_id: chargeId });
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

    if (source === "quick" && patientId === null) {
      res.status(400).json({
        error: "Quick notes require patient_id to save in patient history.",
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
      if (patientId !== null) {
        await ensurePatientBelongsClinic(context.clinicId, patientId);
      }

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

      if (source === "quick" && patientId === null) {
        res.status(400).json({
          error: "Quick notes require patient_id to save in patient history.",
        });
        return;
      }

      if (patientId !== null) {
        await ensurePatientBelongsClinic(context.clinicId, patientId);
      }

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


