export type UserRole = "admin" | "professional" | "secretary";

export type BillingMode = "session" | "monthly";

export type AppointmentStatus = "scheduled" | "completed" | "cancelled";
export type SessionType = "individual" | "couple";
export type SessionMode = "in_person" | "online";

export interface Patient {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  cpf: string | null;
  address: string | null;
  anamnese?: string | null;
  notes: string | null;
  created_at: string;
  session_fee: number | null;
  billing_mode_override: BillingMode | null;
  session_count?: number;
}

export interface ClinicMember {
  id: number;
  clinic_id: string;
  user_id: string;
  role: UserRole;
  active: boolean;
  created_at: string;
  email?: string | null;
  full_name?: string | null;
}

export interface Appointment {
  id: number;
  clinic_id: string;
  user_id: string;
  patient_id: number;
  patient_name?: string | null;
  provider_user_id?: string | null;
  provider_name?: string | null;
  secondary_patient_id?: number | null;
  secondary_patient_name?: string | null;
  start_time: string;
  end_time: string;
  status: AppointmentStatus;
  notes?: string | null;
  session_type?: SessionType | null;
  session_mode?: SessionMode | null;
  online_meeting_url?: string | null;
  duration_minutes?: number;
  is_block?: boolean;
  series_id?: number | null;
  series_sequence?: number | null;
  google_sync_status?: string | null;
}

export interface FinancialRecord {
  id: number;
  clinic_id: string;
  user_id: string;
  patient_id: number | null;
  patient_name?: string | null;
  amount: number;
  type: "income" | "expense";
  category: string | null;
  description: string | null;
  date: string;
  status: "paid" | "pending";
}

export interface AiUsageSummaryTotals {
  requests: number;
  success_count: number;
  failed_count: number;
  input_audio_bytes: number;
  input_seconds: number;
  input_minutes: number;
  input_tokens_estimated: number;
  output_tokens_estimated: number;
  total_tokens_estimated: number;
  estimated_cost: number;
}

export interface AiUsageSummaryByModel {
  model: string;
  requests: number;
  success_count: number;
  failed_count: number;
  total_tokens_estimated: number;
  estimated_cost: number;
}

export interface AiUsageSummaryByDay {
  day: string;
  requests: number;
  success_count: number;
  failed_count: number;
  total_tokens_estimated: number;
  estimated_cost: number;
}

export interface AiUsageSummaryRecentItem {
  id: number | null;
  model: string;
  status: "success" | "failed";
  created_at: string | null;
  total_tokens_estimated: number;
  estimated_cost: number;
}

export interface AiUsageSummary {
  period: string;
  pricing: {
    token_cost_per_million: number;
    audio_cost_per_minute: number;
    audio_tokens_per_minute: number;
    currency: string;
  };
  totals: AiUsageSummaryTotals;
  by_model: AiUsageSummaryByModel[];
  by_day: AiUsageSummaryByDay[];
  recent: AiUsageSummaryRecentItem[];
}
