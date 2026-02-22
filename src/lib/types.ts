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
