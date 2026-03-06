import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

dotenv.config({ path: ".env.local" });
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const supabaseUrl = process.env.SUPABASE_URL || "";
export const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
export const geminiApiKey = process.env.GEMINI_API_KEY || "";
export const asaasApiKey = process.env.ASAAS_API_KEY || "";
export const asaasBaseUrl = process.env.ASAAS_BASE_URL || "https://sandbox.asaas.com/api/v3";
export const asaasWebhookToken = process.env.ASAAS_WEBHOOK_TOKEN || "";
export const asaasDefaultSessionValue = Number(process.env.ASAAS_DEFAULT_SESSION_VALUE || "150");
export const evolutionWebhookToken = process.env.EVOLUTION_WEBHOOK_TOKEN || "";
export const appUrl = process.env.APP_URL || "http://localhost:3000";
export const adminUrl = process.env.ADMIN_URL || "";
export const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
export const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
export const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI || `${appUrl}/api/integrations/google/callback`;
export const googleWebhookToken = process.env.GOOGLE_WEBHOOK_TOKEN || "";
export const integrationsSecret = process.env.INTEGRATIONS_ENCRYPTION_KEY || supabaseServiceRoleKey;
export const internalJobToken = process.env.INTERNAL_JOB_TOKEN || "";
export const sentryDsn = process.env.SENTRY_DSN || "";
export const nodeEnv = process.env.NODE_ENV || "development";
export const isProduction = nodeEnv === "production";
export const allowDevUserBypass = !isProduction && String(process.env.ALLOW_DEV_USER_BYPASS || "").toLowerCase() === "true";
export const PORT = Number(process.env.PORT || 3000);

export const featureGoogleEnabled =
    process.env.FEATURE_GOOGLE_ENABLED === undefined
        ? !isProduction
        : String(process.env.FEATURE_GOOGLE_ENABLED).toLowerCase() === "true";
export const featureAsaasEnabled =
    process.env.FEATURE_ASAAS_ENABLED === undefined
        ? !isProduction
        : String(process.env.FEATURE_ASAAS_ENABLED).toLowerCase() === "true";
export const corsAllowedOrigins = String(process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
export const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || "900000");
export const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || "300");

export const aiModelName = process.env.AI_MODEL_NAME || "gemini-2.5-flash";
export const aiTokenCostPerMillion = Number(process.env.AI_TOKEN_COST_PER_MILLION || "0");

export function extractHost(value: string | null | undefined) {
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

export const superadminAllowedHosts = Array.from(
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
export const superadminBootstrapUserIds = Array.from(
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
