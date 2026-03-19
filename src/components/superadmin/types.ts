export type TenantStatus = "trialing" | "active" | "past_due" | "suspended" | "cancelled";
export type BillingProvider = "manual" | "asaas";

export type SuperadminMe = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  active: boolean;
  allowed_hosts: string[];
};

export type OverviewPayload = {
  totals: {
    clinics_total: number;
    active: number;
    trialing: number;
    past_due: number;
    suspended: number;
    cancelled: number;
    blocked: number;
    members_total: number;
  };
  recent_clinics: Array<{
    id: string;
    name: string;
    created_at: string;
    status: TenantStatus;
  }>;
};

export type ClinicItem = {
  id: string;
  name: string;
  created_at: string;
  owner_user_id: string;
  owner_email: string | null;
  owner_full_name: string | null;
  subscription: {
    clinic_id: string;
    plan_code: string | null;
    status: TenantStatus;
    billing_provider: BillingProvider;
    asaas_customer_id: string | null;
    asaas_subscription_id: string | null;
    trial_ends_at: string | null;
    current_period_start: string | null;
    current_period_end: string | null;
    payment_grace_until: string | null;
    next_charge_at: string | null;
    blocked_at: string | null;
    suspended_reason: string | null;
    updated_at: string | null;
  };
  members: {
    active_members: number;
    roles: {
      admin: number;
      professional: number;
      secretary: number;
    };
  };
  features: {
    enabled_count: number;
    total_count: number;
  };
};

export type ClinicsPayload = {
  clinics: ClinicItem[];
};

export type FeatureFlag = {
  clinic_id: string;
  feature_key: string;
  enabled: boolean;
  config: Record<string, unknown>;
  updated_at: string | null;
};

export type FeaturePayload = {
  features: FeatureFlag[];
};

export type AuditLog = {
  id: number;
  actor_user_id: string | null;
  actor_type: "superadmin" | "system";
  action: string;
  target_type: string;
  target_id: string | null;
  clinic_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AuditPayload = {
  logs: AuditLog[];
};

export type SubscriptionFormState = {
  plan_code: string;
  status: TenantStatus;
  billing_provider: BillingProvider;
  asaas_customer_id: string;
  asaas_subscription_id: string;
  trial_ends_at: string;
  current_period_start: string;
  current_period_end: string;
  payment_grace_until: string;
  next_charge_at: string;
  suspended_reason: string;
};

export type CreateClinicFormState = {
  name: string;
  owner_email: string;
  owner_full_name: string;
  owner_password: string;
  plan_code: string;
  status: TenantStatus;
  billing_provider: BillingProvider;
};

export type CreateClinicResponse = {
  clinic: {
    id: string;
    name: string;
    owner_user_id: string;
    created_at: string;
  };
  owner: {
    user_id: string;
    email: string | null;
    full_name: string | null;
    created: boolean;
    temporary_password: string | null;
  };
  subscription: ClinicItem["subscription"];
};

export type CreateClinicFlash = {
  clinic_name: string;
  owner_email: string | null;
  owner_created: boolean;
  temporary_password: string | null;
};

export const statusLabels: Record<TenantStatus, string> = {
  trialing: "Teste",
  active: "Ativa",
  past_due: "Em atraso",
  suspended: "Suspensa",
  cancelled: "Cancelada",
};

export const featureLabels: Record<string, string> = {
  "billing.asaas": "Asaas habilitado",
  "messaging.evolution": "Evolution API",
  "messaging.inbox": "Caixa de mensagens",
  "crm.kanban": "Kanban CRM",
  "crm.pipeline_automation": "Automacoes por labels",
  "ai.assistant": "Assistente IA",
};

export const defaultCreateClinicFeatures = Object.keys(featureLabels);

export function toDateInput(value: string | null | undefined) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

export function toLocalDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("pt-BR");
}

export function emptySubscriptionForm(): SubscriptionFormState {
  return {
    plan_code: "starter",
    status: "active",
    billing_provider: "manual",
    asaas_customer_id: "",
    asaas_subscription_id: "",
    trial_ends_at: "",
    current_period_start: "",
    current_period_end: "",
    payment_grace_until: "",
    next_charge_at: "",
    suspended_reason: "",
  };
}

export function emptyCreateClinicForm(): CreateClinicFormState {
  return {
    name: "",
    owner_email: "",
    owner_full_name: "",
    owner_password: "",
    plan_code: "starter",
    status: "active",
    billing_provider: "manual",
  };
}
