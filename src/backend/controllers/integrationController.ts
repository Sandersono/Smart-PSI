import { Request, Response } from "express";
import { supabase } from "../db.js";
import { handleRouteError, HttpError, decryptSecret } from "../utils/index.js";
import { asaasBaseUrl, googleClientId, googleClientSecret, appUrl } from "../config.js";

export async function testIntegrations(req: Request, res: Response) {
    try {
        const clinicId = req.userContext?.clinicId;
        if (!clinicId) throw new HttpError(401, "Not authorized");

        const { data: asaasKeys } = await supabase
            .from("asaas_apikeys")
            .select("encrypted_key")
            .eq("clinic_id", clinicId)
            .single();

        let asaasStatus = "disconnected";
        let googleStatus = "disconnected";

        if (asaasKeys?.encrypted_key) {
            try {
                const apiKey = decryptSecret(asaasKeys.encrypted_key);
                const testRes = await fetch(`${asaasBaseUrl}/customers?limit=1`, {
                    headers: { access_token: apiKey },
                });
                if (testRes.ok) asaasStatus = "connected";
                else {
                    const err = await testRes.text();
                    console.warn("Asaas ping failed", err);
                    asaasStatus = "error";
                }
            } catch (err) {
                console.error("Asaas connection test failed", err);
                asaasStatus = "error";
            }
        }

        const { data: gTokens } = await supabase
            .from("google_calendar_tokens")
            .select("access_token")
            .eq("clinic_id", clinicId)
            .single();

        if (gTokens?.access_token) {
            try {
                const testRes = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1", {
                    headers: { Authorization: `Bearer ${decryptSecret(gTokens.access_token)}` }
                });
                if (testRes.ok) googleStatus = "connected";
                else googleStatus = "error";
            } catch (err) {
                console.error("Google ping failed", err);
                googleStatus = "error";
            }
        }

        res.json({ asaas: asaasStatus, google: googleStatus });
    } catch (err) {
        handleRouteError(res, err, "GET /api/integrations/test");
    }
}
