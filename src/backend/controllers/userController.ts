import { Request, Response } from "express";
import { supabase } from "../db.js";
import { handleRouteError, HttpError, isMissingRelationError } from "../utils/index.js";

export async function getCurrentProfile(req: Request, res: Response) {
    try {
        if (req.tenantAccess?.blocked) {
            return res.status(403).json({ error: req.tenantAccess.reason });
        }

        const context = req.userContext;
        if (!context) throw new HttpError(401, "Not authorized");

        // Keep profile lookup as optional metadata. Canonical auth context comes from middleware.
        const { data: profile, error } = await supabase
            .from("profiles")
            .select(
                `
                id,
                clinic_id,
                role,
                full_name,
                clinics(id, name, slug)
                `
            )
            .eq("id", context.userId)
            .maybeSingle();

        if (error && !isMissingRelationError(error)) {
            throw error;
        }

        res.json({
            user_id: context.userId,
            clinic_id: context.clinicId,
            role: context.role,
            profile: profile || null,
        });
    } catch (err) {
        handleRouteError(res, err, "GET /api/me");
    }
}

export async function checkFirstTimeSetup(req: Request, res: Response) {
    try {
        const userId = req.userContext?.userId;
        if (!userId) throw new HttpError(401, "Not authorized");
        const { data: memberships, error } = await supabase
            .from("clinic_members")
            .select("clinic_id, active, created_at")
            .eq("user_id", userId)
            .eq("active", true)
            .order("created_at", { ascending: true });

        if (error) {
            if (isMissingRelationError(error)) {
                throw new HttpError(
                    503,
                    "Database schema is outdated. Run migration 20260221_002_clinic_rbac_agenda_asaas.sql."
                );
            }
            throw error;
        }

        const activeMemberships = memberships || [];
        if (activeMemberships.length === 0) {
            return res.json({ redirect: "/onboarding", reason: "no_membership" });
        }

        const clinicIds = Array.from(new Set(activeMemberships.map((item) => String(item.clinic_id))));
        const { data: clinics, error: clinicError } = await supabase
            .from("clinics")
            .select("id")
            .in("id", clinicIds);
        if (clinicError) {
            throw clinicError;
        }

        if (!clinics || clinics.length === 0) {
            return res.json({ redirect: "/onboarding", reason: "clinic_not_found" });
        }

        res.json({ redirect: "/dashboard", reason: "setup_complete" });
    } catch (err) {
        handleRouteError(res, err, "GET /api/check-first-time-setup");
    }
}
