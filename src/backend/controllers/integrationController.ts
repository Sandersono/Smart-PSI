import { Request, Response as ExpressResponse } from "express";
import { supabase } from "../db.js";
import {
    handleRouteError,
    HttpError,
    decryptSecret,
    encryptSecret,
    isMissingRelationError,
} from "../utils/index.js";
import {
    asaasApiKey,
    asaasBaseUrl,
    featureAsaasEnabled,
    featureGoogleEnabled,
    googleClientId,
    googleClientSecret,
    googleRedirectUri,
} from "../config.js";

type ProbeStatus = "connected" | "disconnected" | "error" | "not_configured" | "disabled";

type ProbeResult = {
    status: ProbeStatus;
    message?: string;
    http_status?: number;
    latency_ms?: number;
};

type GoogleConnectionRow = {
    id: number;
    access_token_encrypted: string | null;
    refresh_token_encrypted: string | null;
    expires_at: string | null;
};

const GOOGLE_CALENDAR_PING_URL =
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const INTEGRATION_TIMEOUT_MS = 10_000;

function trimMessage(raw: string | null | undefined, fallback: string) {
    const value = String(raw || "").trim();
    if (!value) return fallback;
    return value.slice(0, 240);
}

async function readResponseError(response: globalThis.Response, fallback: string) {
    const raw = await response.text();
    if (!raw) return fallback;
    try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const message =
            typeof parsed.error === "string"
                ? parsed.error
                : typeof parsed.message === "string"
                    ? parsed.message
                    : fallback;
        return trimMessage(message, fallback);
    } catch {
        return trimMessage(raw, fallback);
    }
}

async function pingAsaas(): Promise<ProbeResult> {
    if (!featureAsaasEnabled) {
        return { status: "disabled", message: "Integracao Asaas desativada por feature flag." };
    }
    if (!asaasApiKey) {
        return { status: "not_configured", message: "ASAAS_API_KEY nao configurada no backend." };
    }

    const startedAt = Date.now();
    try {
        const response = await fetch(`${asaasBaseUrl}/customers?limit=1`, {
            method: "GET",
            headers: { access_token: asaasApiKey },
            signal: AbortSignal.timeout(INTEGRATION_TIMEOUT_MS),
        });
        const latencyMs = Date.now() - startedAt;

        if (!response.ok) {
            const message = await readResponseError(response, "Falha ao consultar Asaas.");
            return {
                status: "error",
                message,
                http_status: response.status,
                latency_ms: latencyMs,
            };
        }

        return {
            status: "connected",
            message: "Conexao com Asaas validada.",
            latency_ms: latencyMs,
        };
    } catch (error) {
        const latencyMs = Date.now() - startedAt;
        return {
            status: "error",
            message: trimMessage(error instanceof Error ? error.message : "", "Erro ao validar Asaas."),
            latency_ms: latencyMs,
        };
    }
}

async function pingGoogleCalendar(accessToken: string): Promise<ProbeResult> {
    const startedAt = Date.now();
    try {
        const response = await fetch(GOOGLE_CALENDAR_PING_URL, {
            method: "GET",
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(INTEGRATION_TIMEOUT_MS),
        });
        const latencyMs = Date.now() - startedAt;
        if (!response.ok) {
            const message = await readResponseError(response, "Falha ao consultar Google Calendar.");
            return {
                status: "error",
                message,
                http_status: response.status,
                latency_ms: latencyMs,
            };
        }
        return {
            status: "connected",
            message: "Conexao com Google Agenda validada.",
            latency_ms: latencyMs,
        };
    } catch (error) {
        const latencyMs = Date.now() - startedAt;
        return {
            status: "error",
            message: trimMessage(error instanceof Error ? error.message : "", "Erro ao validar Google Agenda."),
            latency_ms: latencyMs,
        };
    }
}

async function refreshGoogleAccessToken(
    connection: GoogleConnectionRow,
    clinicId: string
): Promise<{ accessToken: string | null; errorMessage?: string }> {
    if (!connection.refresh_token_encrypted) {
        return { accessToken: null, errorMessage: "Refresh token ausente. Reconecte a conta Google." };
    }
    if (!googleClientId || !googleClientSecret || !googleRedirectUri) {
        return {
            accessToken: null,
            errorMessage: "Credenciais OAuth Google incompletas para renovar token.",
        };
    }

    let refreshToken: string;
    try {
        refreshToken = decryptSecret(connection.refresh_token_encrypted);
    } catch (error) {
        return {
            accessToken: null,
            errorMessage: trimMessage(
                error instanceof Error ? error.message : "",
                "Falha ao ler refresh token do Google."
            ),
        };
    }

    const body = new URLSearchParams({
        client_id: googleClientId,
        client_secret: googleClientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
    });

    const response = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(INTEGRATION_TIMEOUT_MS),
    });

    if (!response.ok) {
        return {
            accessToken: null,
            errorMessage: await readResponseError(response, "Falha ao renovar token Google."),
        };
    }

    const payload = (await response.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
    };
    const nextAccessToken = String(payload.access_token || "").trim();
    if (!nextAccessToken) {
        return { accessToken: null, errorMessage: "Google nao retornou access_token na renovacao." };
    }

    const expiresAt =
        typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
            ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
            : null;

    const { error: updateError } = await supabase
        .from("google_user_connections")
        .update({
            access_token_encrypted: encryptSecret(nextAccessToken),
            refresh_token_encrypted: payload.refresh_token
                ? encryptSecret(String(payload.refresh_token))
                : connection.refresh_token_encrypted,
            expires_at: expiresAt,
            active: true,
            updated_at: new Date().toISOString(),
        })
        .eq("id", connection.id)
        .eq("clinic_id", clinicId);

    if (updateError) {
        return {
            accessToken: null,
            errorMessage: trimMessage(updateError.message, "Falha ao salvar token Google renovado."),
        };
    }

    return { accessToken: nextAccessToken };
}

async function pingGoogle(clinicId: string, userId: string): Promise<ProbeResult> {
    if (!featureGoogleEnabled) {
        return { status: "disabled", message: "Integracao Google desativada por feature flag." };
    }

    const oauthConfigured = Boolean(googleClientId && googleClientSecret && googleRedirectUri);
    try {
        const { data: connection, error } = await supabase
            .from("google_user_connections")
            .select("id, access_token_encrypted, refresh_token_encrypted, expires_at")
            .eq("clinic_id", clinicId)
            .eq("user_id", userId)
            .eq("active", true)
            .maybeSingle();

        if (error) {
            if (isMissingRelationError(error)) {
                return {
                    status: "error",
                    message: "Schema Google nao encontrado. Execute migracoes pendentes.",
                };
            }
            throw error;
        }

        if (!connection) {
            return oauthConfigured
                ? { status: "disconnected", message: "Conta Google nao conectada." }
                : { status: "not_configured", message: "OAuth Google nao configurado no backend." };
        }

        if (!connection.access_token_encrypted) {
            return { status: "error", message: "Token Google ausente para a conexao ativa." };
        }

        let accessToken: string;
        try {
            accessToken = decryptSecret(connection.access_token_encrypted);
        } catch (error) {
            return {
                status: "error",
                message: trimMessage(
                    error instanceof Error ? error.message : "",
                    "Falha ao ler token do Google."
                ),
            };
        }

        let result = await pingGoogleCalendar(accessToken);
        if (result.status === "connected") {
            return result;
        }

        // Try token refresh when Google returns 401.
        if (result.http_status === 401) {
            const refreshed = await refreshGoogleAccessToken(connection, clinicId);
            if (!refreshed.accessToken) {
                return {
                    status: "error",
                    message: refreshed.errorMessage || "Falha ao renovar token Google.",
                    http_status: 401,
                    latency_ms: result.latency_ms,
                };
            }
            result = await pingGoogleCalendar(refreshed.accessToken);
            if (result.status === "connected") {
                return { ...result, message: "Google validado apos renovacao do token." };
            }
        }

        return result;
    } catch (error) {
        return {
            status: "error",
            message: trimMessage(
                error instanceof Error ? error.message : "",
                "Erro ao validar conexao Google."
            ),
        };
    }
}

export async function testIntegrations(req: Request, res: ExpressResponse) {
    try {
        const context = req.userContext;
        if (!context?.clinicId || !context.userId) throw new HttpError(401, "Not authorized");

        const [asaas, google] = await Promise.all([
            pingAsaas(),
            pingGoogle(context.clinicId, context.userId),
        ]);

        res.json({
            tested_at: new Date().toISOString(),
            asaas,
            google,
        });
    } catch (err) {
        handleRouteError(res, err, "GET /api/integrations/test");
    }
}
