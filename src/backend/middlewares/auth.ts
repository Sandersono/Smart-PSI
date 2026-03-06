import { Request, Response, NextFunction } from "express";
import { UserContext, UserRole, SuperadminContext, TenantStatus } from "../types/index.js";
import { supabase } from "../db.js";
import { allowDevUserBypass, superadminAllowedHosts, superadminBootstrapUserIds } from "../config.js";
import { HttpError, toNullableString } from "../utils/index.js";
import { isMissingRelationError } from "../utils/index.js";

declare global {
    namespace Express {
        interface Request {
            userContext?: UserContext;
            superadminContext?: SuperadminContext;
            tenantAccess?: {
                status: TenantStatus | null;
                blocked: boolean;
                reason: string | null;
            };
        }
    }
}

export async function authenticateToken(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers["authorization"];
    const token = authHeader?.split(" ")[1];

    if (!token) {
        if (allowDevUserBypass) {
            if (req.headers["x-dev-admin"] === "true") {
                req.userContext = { userId: "dev-admin", clinicId: "dev-clinic", role: "admin" };
                return next();
            }
            if (req.headers["x-dev-prof"] === "true") {
                req.userContext = { userId: "dev-prof", clinicId: "dev-clinic", role: "professional" };
                return next();
            }
            if (req.headers["x-dev-sec"] === "true") {
                req.userContext = { userId: "dev-sec", clinicId: "dev-clinic", role: "secretary" };
                return next();
            }
        }
        return res.status(401).json({ error: "No token provided" });
    }

    try {
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data.user) {
            return res.status(401).json({ error: "Invalid token" });
        }

        const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("clinic_id, role")
            .eq("id", data.user.id)
            .single();

        if (profileError && isMissingRelationError(profileError)) {
            req.userContext = { userId: data.user.id, clinicId: "system", role: "admin" };
            return next();
        }

        if (profileError || !profile) {
            return res.status(403).json({ error: "Profile not found or missing clinic assignment" });
        }

        const { clinic_id, role } = profile;
        req.userContext = { userId: data.user.id, clinicId: clinic_id, role: role as UserRole };
        next();
    } catch (err) {
        console.error("[AuthMiddleware] unexpected error:", err);
        res.status(500).json({ error: "Internal Auth Error" });
    }
}

export function requireRole(allowedRoles: UserRole[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.userContext) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        if (!allowedRoles.includes(req.userContext.role)) {
            return res.status(403).json({ error: "Forbidden: insufficient role permissions" });
        }
        next();
    };
}

export function requireUserContext(req: Request, res: Response, next: NextFunction) {
    if (!req.userContext) {
        return res.status(401).json({ error: "Unauthorized: Missing user context" });
    }
    next();
}

export async function checkTenantAccess(req: Request, res: Response, next: NextFunction) {
    if (!req.userContext) {
        return next();
    }
    const clinicId = req.userContext.clinicId;

    if (allowDevUserBypass && clinicId === "dev-clinic") {
        req.tenantAccess = { status: "active", blocked: false, reason: null };
        return next();
    }

    try {
        const { data, error } = await supabase
            .from("clinics")
            .select("status, subscription_status")
            .eq("id", clinicId)
            .single();

        if (error) {
            if (isMissingRelationError(error)) {
                req.tenantAccess = { status: "active", blocked: false, reason: null };
                return next();
            }
            throw error;
        }

        let isBlocked = false;
        let computedStatus: TenantStatus | null = null;
        let reason: string | null = null;

        if (data) {
            if (data.status === "inactive" || data.status === "suspended") {
                isBlocked = true;
                reason = "Clinic scale operations suspended.";
            }
            computedStatus = data.subscription_status as TenantStatus | null;
            if (computedStatus === "suspended" || computedStatus === "cancelled") {
                isBlocked = true;
                reason = "Subscription suspended or cancelled.";
            }
        }

        req.tenantAccess = {
            status: computedStatus,
            blocked: isBlocked,
            reason,
        };
        next();
    } catch (error) {
        console.error("[TenantAccessGuard]", error);
        next();
    }
}

export async function authenticateSuperadminUser(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers["authorization"];
    const token = authHeader?.split(" ")[1];

    if (!token) {
        if (allowDevUserBypass && req.headers["x-dev-superadmin"] === "true") {
            req.superadminContext = { userId: "dev-superadmin" };
            return next();
        }
        return res.status(401).json({ error: "No token provided" });
    }

    try {
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data.user) {
            return res.status(401).json({ error: "Invalid token" });
        }

        const userId = data.user.id;
        let isSuperadmin = superadminBootstrapUserIds.includes(userId);

        if (!isSuperadmin) {
            const { data: superQuery, error: superError } = await supabase
                .from("superadmin_users")
                .select("id")
                .eq("user_id", userId)
                .maybeSingle();
            if (!superError && superQuery) {
                isSuperadmin = true;
            }
        }

        if (!isSuperadmin) {
            return res.status(403).json({ error: "Forbidden: Not superadmin" });
        }

        req.superadminContext = { userId };
        next();
    } catch (error) {
        console.error("[SuperadminAuth]", error);
        res.status(500).json({ error: "Internal Auth Error" });
    }
}
