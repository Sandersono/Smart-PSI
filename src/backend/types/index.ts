export type UserRole = "admin" | "professional" | "secretary";
export type TenantStatus = "trialing" | "active" | "past_due" | "suspended" | "cancelled";
export type BillingProvider = "manual" | "asaas";
export type AppointmentStatus = "scheduled" | "completed" | "cancelled";
export type SessionType = "individual" | "couple";
export type SessionMode = "in_person" | "online";
export type RecurrenceFrequency = "weekly" | "biweekly" | "monthly";
export type ApplyScope = "single" | "following" | "all";
export type BillingMode = "session" | "monthly";
export type NoteSource = "audio" | "quick" | "manual";
export type GoogleReminderPreset = "light" | "standard" | "intense";
export type AiUsageStatus = "success" | "failed";
export type EvolutionConnectionStatus = "connected" | "disconnected" | "error";
export type InboxThreadStatus = "open" | "pending" | "resolved" | "blocked";
export type InboxMessageDirection = "inbound" | "outbound" | "system";

export type UserContext = {
  userId: string;
  clinicId: string;
  role: UserRole;
};

export type SuperadminContext = {
  userId: string;
};

export type TenantAccessState = {
  status: TenantStatus | null;
  blocked: boolean;
  reason: string | null;
};
