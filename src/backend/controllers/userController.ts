import { Request, Response } from "express";
import { supabase } from "../db.js";
import { handleRouteError, HttpError } from "../utils/index.js";

export async function getCurrentProfile(req: Request, res: Response) {
    try {
        const userId = req.userContext?.userId;
        if (!userId) throw new HttpError(401, "Not authorized");

        const { data: profile, error } = await supabase
            .from("profiles")
            .select(`
        *,
        clinics(id, name, slug)
      `)
            .eq("id", userId)
            .single();

        if (error) {
            if (error.code === "PGRST116") throw new HttpError(404, "Profile not found");
            throw error;
        }
        res.json({ profile });
    } catch (err) {
        handleRouteError(res, err, "GET /api/me");
    }
}

export async function checkFirstTimeSetup(req: Request, res: Response) {
    try {
        const userId = req.userContext?.userId;
        if (!userId) throw new HttpError(401, "Not authorized");
        const { data: profile, error } = await supabase
            .from("profiles")
            .select("clinic_id")
            .eq("id", userId)
            .single();

        if (error || !profile) {
            if (error?.code !== "PGRST116") {
                console.error("Error fetching profile", error);
            }
            return res.json({ redirect: "/onboarding", reason: "no_profile" });
        }
        if (!profile.clinic_id) {
            return res.json({ redirect: "/onboarding", reason: "no_clinic_id" });
        }

        const { data: clinic, error: clinicError } = await supabase
            .from("clinics")
            .select("id")
            .eq("id", profile.clinic_id)
            .single();
        if (clinicError || !clinic) {
            return res.json({ redirect: "/onboarding", reason: "clinic_not_found" });
        }

        res.json({ redirect: "/dashboard", reason: "setup_complete" });
    } catch (err) {
        handleRouteError(res, err, "GET /api/check-first-time-setup");
    }
}
