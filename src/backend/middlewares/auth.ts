import { Request, Response, NextFunction } from "express";
import { UserContext, UserRole, SuperadminContext, TenantStatus } from "../types/index.js";
import { supabase } from "../db.js";
import { allowDevUserBypass, superadminBootstrapUserIds } from "../config.js";
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

async function resolveAuthenticatedUserId(req: Request) {
    const authHeader = req.headers["authorization"];
    const token = authHeader?.split(" ")[1];

    if (!token) {
        if (allowDevUserBypass) {
            const bypassUserId = req.headers["x-user-id"];
            if (typeof bypassUserId === "string" && bypassUserId) {
                return bypassUserId;
            }
            if (req.headers["x-dev-admin"] === "true") return "dev-admin";
            if (req.headers["x-dev-prof"] === "true") return "dev-prof";
            if (req.headers["x-dev-sec"] === "true") return "dev-sec";
        }
        return null;
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
        return null;
    }

    return data.user.id;
}

async function resolveClinicMembership(userId: string, preferredClinicId?: string | null) {
    const { data: memberships, error } = await supabase
        .from("clinic_members")
        .select("clinic_id, role, active, created_at")
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
        return null;
    }

    const selectedMembership =
        (preferredClinicId
            ? activeMemberships.find((item) => String(item.clinic_id) === preferredClinicId)
            : null) || activeMemberships[0];

    const role = selectedMembership?.role;
    const parsedRole: UserRole =
        role === "admin" || role === "professional" || role === "secretary" ? role : "professional";

    return {
        clinicId: String(selectedMembership.clinic_id),
        role: parsedRole,
    };
}

export async function authenticateToken(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = await resolveAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: "Invalid token" });
        }

        const membership = await resolveClinicMembership(
            userId,
            typeof req.headers["x-clinic-id"] === "string" ? req.headers["x-clinic-id"] : null
        );
        if (!membership) {
            return res.status(403).json({ error: "No active clinic membership found for this user" });
        }

        req.userContext = { userId, clinicId: membership.clinicId, role: membership.role };
        next();
    } catch (err) {
        console.error("[AuthMiddleware] unexpected error:", err);
        res.status(500).json({ error: "Internal Auth Error" });
    }
}

export async function authenticateIdentity(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = await resolveAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: "Invalid token" });
        }
        req.userContext = {
            userId,
            clinicId: "",
            role: "admin",
        };
        next();
    } catch (err) {
        console.error("[AuthIdentity] unexpected error:", err);
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
    if (!clinicId) {
        req.tenantAccess = { status: null, blocked: false, reason: null };
        return next();
    }

    if (allowDevUserBypass && clinicId === "dev-clinic") {
        req.tenantAccess = { status: "active", blocked: false, reason: null };
        return next();
    }

    try {
        const { data, error } = await supabase
            .from("tenant_subscriptions")
            .select("status, payment_grace_until, suspended_reason")
            .eq("clinic_id", clinicId)
            .maybeSingle();

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
            computedStatus = (toNullableString(data.status) as TenantStatus | null) || null;
            if (computedStatus === "past_due") {
                const graceUntilRaw = toNullableString(data.payment_grace_until);
                const graceUntil = graceUntilRaw ? new Date(graceUntilRaw) : null;
                if (!graceUntil || Number.isNaN(graceUntil.getTime()) || graceUntil.getTime() < Date.now()) {
                    isBlocked = true;
                    reason = "Acesso bloqueado por pendencia financeira.";
                }
            }
            if (computedStatus === "suspended" || computedStatus === "cancelled") {
                isBlocked = true;
                reason =
                    toNullableString(data.suspended_reason) ||
                    (computedStatus === "suspended"
                        ? "Acesso bloqueado administrativamente."
                        : "Assinatura cancelada.");
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
    try {
        if (allowDevUserBypass && req.headers["x-dev-superadmin"] === "true") {
            req.superadminContext = { userId: "dev-superadmin" };
            return next();
        }

        const userId = await resolveAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: "Invalid token" });
        }

        let isSuperadmin = superadminBootstrapUserIds.includes(userId);

        if (!isSuperadmin) {
            const { data: superQuery, error: superError } = await supabase
                .from("platform_superadmins")
                .select("user_id, active")
                .eq("user_id", userId)
                .maybeSingle();
            if (!superError && superQuery && superQuery.active !== false) {
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
