import { Response } from "express";
import { UserContext, UserRole, TenantStatus, AppointmentStatus, SessionMode, SessionType, RecurrenceFrequency, BillingMode, NoteSource, GoogleReminderPreset, InboxThreadStatus, InboxMessageDirection, EvolutionConnectionStatus } from "../types/index.js";
import crypto from "crypto";
import { integrationsSecret, appUrl, asaasBaseUrl, asaasApiKey, evolutionWebhookToken, googleWebhookToken, googleClientId, googleClientSecret, googleRedirectUri } from "../config.js";
import * as Sentry from "@sentry/node";

export class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

export function handleRouteError(res: Response, error: unknown, contextLabel: string) {
    if (error instanceof HttpError) {
        res.status(error.status).json({ error: error.message });
        return;
    }

    if (isMissingRelationError(error)) {
        console.error(`[${contextLabel}] Missing relation error (migration needed):`, (error as any).message || error);
        res.status(503).json({ error: "Servico temporariamente indisponivel (falha de schema do banco)" });
        return;
    }

    console.error(`[${contextLabel}] Unexpected error:`, error);
    Sentry.captureException(error, { extra: { contextLabel } });

    const errorMessage = error instanceof Error ? error.message : "Internal Server Error";
    res.status(500).json({ error: errorMessage });
}

export function isMissingRelationError(error: unknown) {
    if (typeof error !== "object" || error === null) return false;
    const e = error as { code?: string; details?: string; message?: string };
    return (
        e.code === "42P01" ||
        e.code === "PGRST205" ||
        (e.message && e.message.includes("relation") && e.message.includes("does not exist"))
    );
}

export function toNullableString(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function toNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export function toDateTimeOrNull(value: unknown): string | null {
    if (typeof value !== "string" || value.trim() === "") return null;
    const normalized = value.includes("T") ? value : `${value}T00:00:00.000Z`;
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
}

export function parseOptionalDateTimeInput(value: unknown, fieldName: string): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    const parsed = toDateTimeOrNull(value);
    if (!parsed) {
        throw new HttpError(400, `${fieldName} must be an ISO datetime or YYYY-MM-DD.`);
    }
    return parsed;
}

export function toBoolean(value: unknown) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const raw = toNullableString(value);
    if (!raw) return false;
    return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
}

const INTEGRATION_ENCRYPTION_KEY = crypto
    .createHash("sha256")
    .update(String(integrationsSecret || "smartpsi"))
    .digest();

export function encryptSecret(raw: string) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", INTEGRATION_ENCRYPTION_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(encoded: string) {
    const [ivRaw, tagRaw, dataRaw] = String(encoded || "").split(".");
    if (!ivRaw || !tagRaw || !dataRaw) {
        throw new HttpError(500, "Malformed encrypted secret payload");
    }
    const iv = Buffer.from(ivRaw, "base64url");
    const tag = Buffer.from(tagRaw, "base64url");
    const data = Buffer.from(dataRaw, "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", INTEGRATION_ENCRYPTION_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function normalizeNoteSource(value: unknown): NoteSource {
    const raw = toNullableString(value);
    if (raw === "audio" || raw === "quick") return raw;
    return "manual";
}

export function parseRole(value: unknown): UserRole | null {
    const raw = toNullableString(value);
    if (raw === "admin" || raw === "professional" || raw === "secretary") return raw;
    return null;
}

export function parseTenantStatus(value: unknown): TenantStatus | null {
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
