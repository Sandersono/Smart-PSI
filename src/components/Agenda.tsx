import React, { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  Plus,
  User,
  ChevronLeft,
  ChevronRight,
  Edit,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Video,
  MapPin,
  Link2,
} from "lucide-react";
import { cn } from "../lib/utils";
import { ApiError, apiRequest } from "../lib/api";
import { ClinicMember, Patient, SessionContext, UserRole } from "../lib/types";
import { Switch } from "./Switch";

interface AgendaProps {
  accessToken: string;
  onStartSession: (patient: { id: string; name: string }) => void;
}

type SessionType = "individual" | "couple";
type SessionMode = "in_person" | "online";
type AppointmentStatus = "scheduled" | "completed" | "cancelled";
type ApplyScope = "single" | "following" | "all";
type RecurrenceFrequency = "weekly" | "biweekly" | "monthly";
type Appointment = {
  id: number;
  patient_id: number;
  provider_user_id?: string | null;
  provider_name?: string | null;
  secondary_patient_id?: number | null;
  patient_name?: string | null;
  secondary_patient_name?: string | null;
  start_time: string;
  status: AppointmentStatus;
  session_type?: SessionType | null;
  session_mode?: SessionMode | null;
  online_meeting_url?: string | null;
  notes?: string | null;
  series_id?: number | null;
  google_sync_status?: string | null;
  is_block?: boolean;
};

type CalendarBlock = {
  id: number;
  provider_user_id: string;
  provider_name?: string | null;
  title?: string | null;
  start_time: string;
  end_time: string;
  source?: string | null;
};

type Provider = {
  user_id: string;
  role: UserRole;
  active: boolean;
  full_name?: string | null;
  email?: string | null;
};

type AppointmentForm = {
  provider_user_id: string;
  patient_id: string;
  secondary_patient_id: string;
  session_type: SessionType;
  session_mode: SessionMode;
  online_meeting_url: string;
  start_time: string;
  notes: string;
  status: AppointmentStatus;
  recurrence_enabled: boolean;
  recurrence_frequency: RecurrenceFrequency;
  recurrence_until_date: string;
  apply_scope: ApplyScope;
};

type Feedback = { type: "success" | "error"; message: string } | null;
type DayEntry =
  | { kind: "appointment"; start_time: string; appointment: Appointment }
  | { kind: "block"; start_time: string; block: CalendarBlock };
type AgendaViewMode = "day" | "week" | "month";

const emptyForm: AppointmentForm = {
  provider_user_id: "",
  patient_id: "",
  secondary_patient_id: "",
  session_type: "individual",
  session_mode: "in_person",
  online_meeting_url: "",
  start_time: "",
  notes: "",
  status: "scheduled",
  recurrence_enabled: false,
  recurrence_frequency: "weekly",
  recurrence_until_date: "",
  apply_scope: "single",
};

function toDateTimeLocal(value: string | null | undefined) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function toDateInput(value: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function toIsoOrNull(value: string) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message || fallback;
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}

function atStartOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function atEndOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function getWeekStartMonday(date: Date) {
  const d = atStartOfDay(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function shiftDateByMode(baseDate: Date, mode: AgendaViewMode, amount: number) {
  const next = new Date(baseDate);
  if (mode === "day") next.setDate(next.getDate() + amount);
  if (mode === "week") next.setDate(next.getDate() + amount * 7);
  if (mode === "month") next.setMonth(next.getMonth() + amount);
  return next;
}

export const Agenda = ({ accessToken, onStartSession }: AgendaProps) => {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [me, setMe] = useState<SessionContext | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  type AppointmentFormState = Omit<Appointment, "id" | "created_at" | "updated_at" | "series_sequence" | "is_exception" | "session_mode" | "patient_id" | "secondary_patient_id"> & {
    session_mode: "in_person" | "online";
    patient_id: number | string;
    secondary_patient_id: number | string | null;
    recurrence_enabled?: boolean;
    recurrence_frequency?: "weekly" | "biweekly" | "monthly";
    recurrence_until_date?: string;
    apply_scope?: "single" | "this" | "following" | "all" | "all_future";
    duration_minutes?: number;
    clinic_id?: string;
    series_id?: number | null;
  };

  const emptyForm: AppointmentFormState = {
    patient_id: "",
    secondary_patient_id: null,
    provider_user_id: "",
    start_time: (() => {
      const d = new Date();
      d.setHours(9, 0, 0, 0);
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      return d.toISOString().slice(0, 16);
    })(),
    duration_minutes: 60,
    session_type: "individual",
    session_mode: "in_person",
    online_meeting_url: "",
    status: "scheduled",
    notes: "",
    recurrence_enabled: false,
    recurrence_frequency: "weekly",
    recurrence_until_date: (() => {
      const d = new Date();
      d.setMonth(d.getMonth() + 3);
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      return d.toISOString().slice(0, 10);
    })(),
    clinic_id: "",
    series_id: null,
    apply_scope: "single"
  };

  const [form, setForm] = useState<AppointmentFormState>(emptyForm);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<AgendaViewMode>("week");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [patientFilter, setPatientFilter] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [patientBlocked, setPatientBlocked] = useState<boolean | null>(null);

  useEffect(() => {
    fetchMe();
    fetchProviders();
    fetchAppointments();
    fetchBlocks();
    fetchPatients();
  }, [accessToken]);

  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(() => setFeedback(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  useEffect(() => {
    if (!isModalOpen || !form.patient_id) {
      setPatientBlocked(null);
      return;
    }
    fetchPatientFinancialStatus(Number(form.patient_id));
  }, [isModalOpen, form.patient_id, accessToken]);

  useEffect(() => {
    if (!isModalOpen || editingAppointment) return;
    if (form.provider_user_id) return;
    const defaultProvider = resolveDefaultProviderId();
    if (!defaultProvider) return;
    setForm((prev) => ({ ...prev, provider_user_id: defaultProvider }));
  }, [isModalOpen, editingAppointment, form.provider_user_id, providers, me]);

  const fetchAppointments = async () => {
    setIsLoading(true);
    try {
      const data = await apiRequest<Appointment[]>("/api/appointments", accessToken);
      setAppointments(data || []);
    } catch (error) {
      console.error("Failed to load appointments", error);
      setFeedback({ type: "error", message: "Falha ao carregar agendamentos." });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchMe = async () => {
    try {
      const data = await apiRequest<SessionContext>("/api/session/context", accessToken);
      setMe(data);
    } catch (error) {
      console.error("Failed to load me context", error);
      setMe(null);
    }
  };

  const fetchProviders = async () => {
    try {
      const data = await apiRequest<ClinicMember[]>("/api/clinic/members", accessToken);
      const onlyProviders = (data || []).filter(
        (item) =>
          Boolean(item.active) &&
          (item.role === "admin" || item.role === "professional")
      );
      setProviders(onlyProviders);
    } catch (error) {
      console.error("Failed to load providers", error);
      setProviders([]);
    }
  };

  const fetchBlocks = async () => {
    try {
      const data = await apiRequest<CalendarBlock[]>("/api/calendar/blocks", accessToken);
      setBlocks(data || []);
    } catch (error) {
      console.error("Failed to load calendar blocks", error);
      setBlocks([]);
    }
  };

  const fetchPatients = async () => {
    try {
      const data = await apiRequest<Patient[]>("/api/patients", accessToken);
      setPatients(data || []);
    } catch (error) {
      console.error("Failed to load patients", error);
      setFeedback({ type: "error", message: "Falha ao carregar pacientes." });
    }
  };

  const fetchPatientFinancialStatus = async (patientId: number) => {
    try {
      const data = await apiRequest<{ blocked: boolean }>(
        `/api/financial/patient/${patientId}/status`,
        accessToken
      );
      setPatientBlocked(Boolean(data?.blocked));
    } catch {
      setPatientBlocked(null);
    }
  };

  const resolveDefaultProviderId = () => {
    if (providerFilter !== "all") return providerFilter;
    const activeRole = me?.active_membership.role;
    if (activeRole === "admin" || activeRole === "professional") {
      const own = providers.find((provider) => provider.user_id === me.user_id);
      if (own) return own.user_id;
      if (me.user_id) return me.user_id;
    }
    return providers[0]?.user_id || "";
  };

  const openCreateModal = () => {
    const start = new Date(selectedDate);
    start.setHours(9, 0, 0, 0);
    const defaultProvider = resolveDefaultProviderId();
    setEditingAppointment(null);
    setForm({
      ...emptyForm,
      provider_user_id: defaultProvider,
      start_time: toDateTimeLocal(start.toISOString()),
      recurrence_until_date: toDateInput(selectedDate),
    });
    setIsModalOpen(true);
  };

  const openEditModal = (appointment: Appointment) => {
    setEditingAppointment(appointment);
    setForm({
      provider_user_id: String(appointment.provider_user_id || resolveDefaultProviderId()),
      patient_id: String(appointment.patient_id || ""),
      secondary_patient_id: appointment.secondary_patient_id
        ? String(appointment.secondary_patient_id)
        : "",
      session_type: appointment.session_type === "couple" ? "couple" : "individual",
      session_mode: appointment.session_mode === "online" ? "online" : "in_person",
      online_meeting_url: appointment.online_meeting_url || "",
      start_time: toDateTimeLocal(appointment.start_time),
      notes: appointment.notes || "",
      status: ["scheduled", "completed", "cancelled"].includes(appointment.status)
        ? appointment.status
        : "scheduled",
      recurrence_enabled: false,
      recurrence_frequency: "weekly",
      recurrence_until_date: toDateInput(selectedDate),
      apply_scope: "single",
    });
    setIsModalOpen(true);
  };

  const saveAppointment = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.patient_id || !form.start_time) {
      setFeedback({ type: "error", message: "Paciente e inicio sao obrigatorios." });
      return;
    }
    if (!form.provider_user_id) {
      setFeedback({ type: "error", message: "Selecione o profissional responsavel." });
      return;
    }
    if (form.session_type === "couple" && !form.secondary_patient_id) {
      setFeedback({ type: "error", message: "Sessao de casal exige segundo paciente." });
      return;
    }
    if (form.session_type === "couple" && form.patient_id === form.secondary_patient_id) {
      setFeedback({ type: "error", message: "O segundo paciente deve ser diferente." });
      return;
    }
    if (form.recurrence_enabled && !form.recurrence_until_date) {
      setFeedback({ type: "error", message: "Data final da recorrencia e obrigatoria." });
      return;
    }

    const startTimeIso = toIsoOrNull(form.start_time);
    if (!startTimeIso) {
      setFeedback({ type: "error", message: "Horario inicial invalido." });
      return;
    }

    const payload = {
      provider_user_id: form.provider_user_id,
      patient_id: Number(form.patient_id),
      secondary_patient_id:
        form.session_type === "couple" && form.secondary_patient_id
          ? Number(form.secondary_patient_id)
          : null,
      session_type: form.session_type,
      session_mode: form.session_mode,
      online_meeting_url:
        form.session_mode === "online" ? form.online_meeting_url.trim() || null : null,
      start_time: startTimeIso,
      notes: form.notes.trim() || null,
      status: form.status,
      apply_scope: form.apply_scope,
      recurrence: form.recurrence_enabled
        ? {
          frequency: form.recurrence_frequency,
          until_date: form.recurrence_until_date,
        }
        : undefined,
    };

    setIsSaving(true);
    try {
      if (!editingAppointment) {
        await apiRequest<{ id: number }>("/api/appointments", accessToken, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setFeedback({ type: "success", message: "Agendamento criado com sucesso." });
      } else {
        await apiRequest<{ ids: number[] }>(`/api/appointments/${editingAppointment.id}`, accessToken, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setFeedback({ type: "success", message: "Agendamento atualizado com sucesso." });
      }
      setIsModalOpen(false);
      setEditingAppointment(null);
      setForm(emptyForm);
      await Promise.all([fetchAppointments(), fetchBlocks()]);
    } catch (error) {
      console.error("Failed to save appointment", error);
      setFeedback({
        type: "error",
        message: getErrorMessage(error, "Falha ao salvar agendamento."),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const deleteAppointment = async (appointment: Appointment) => {
    let scope: ApplyScope = "single";
    if (appointment.series_id) {
      const input = window.prompt(
        'Excluir recorrência: "single", "following" (esta e próximas) ou "all" (toda série).',
        "single"
      );
      if (!input) return;
      if (input !== "single" && input !== "following" && input !== "all") {
        setFeedback({ type: "error", message: "Escopo inválido. Use single/following/all." });
        return;
      }
      scope = input;
    } else {
      const confirmed = window.confirm("Excluir este agendamento?");
      if (!confirmed) return;
    }

    setDeletingId(appointment.id);
    try {
      await apiRequest<{ success: boolean }>(
        `/api/appointments/${appointment.id}?scope=${scope}`,
        accessToken,
        {
          method: "DELETE",
        }
      );
      setFeedback({ type: "success", message: "Agendamento excluido com sucesso." });
      await Promise.all([fetchAppointments(), fetchBlocks()]);
    } catch (error) {
      console.error("Failed to delete appointment", error);
      setFeedback({
        type: "error",
        message: getErrorMessage(error, "Falha ao excluir agendamento."),
      });
    } finally {
      setDeletingId(null);
    }
  };

  const deleteCalendarBlock = async (block: CalendarBlock) => {
    const confirmed = window.confirm("Excluir este bloqueio externo da agenda?");
    if (!confirmed) return;

    setDeletingId(Number(block.id));
    try {
      await apiRequest<{ success: boolean }>(`/api/calendar/blocks/${block.id}`, accessToken, {
        method: "DELETE",
      });
      await fetchBlocks();
      setFeedback({ type: "success", message: "Bloqueio removido." });
    } catch (error) {
      console.error("Failed to delete calendar block", error);
      setFeedback({
        type: "error",
        message: getErrorMessage(error, "Falha ao remover bloqueio externo."),
      });
    } finally {
      setDeletingId(null);
    }
  };

  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const calendarDays = useMemo(() => {
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();
    const totalDays = daysInMonth(year, month);
    const startDay = firstDayOfMonth(year, month);
    const items: Array<number | null> = [];

    for (let i = 0; i < startDay; i += 1) items.push(null);
    for (let d = 1; d <= totalDays; d += 1) items.push(d);
    return items;
  }, [selectedDate]);

  const periodRange = useMemo(() => {
    if (viewMode === "day") {
      return {
        start: atStartOfDay(selectedDate),
        end: atEndOfDay(selectedDate),
      };
    }

    if (viewMode === "week") {
      const start = getWeekStartMonday(selectedDate);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      return { start, end: atEndOfDay(end) };
    }

    const start = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const end = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
    return { start, end: atEndOfDay(end) };
  }, [selectedDate, viewMode]);

  const filteredAppointments = useMemo(
    () =>
      appointments
        .filter((a) => {
          const d = new Date(a.start_time);
          const inRange = d >= periodRange.start && d <= periodRange.end;
          if (!inRange) return false;
          if (providerFilter !== "all" && String(a.provider_user_id || "") !== providerFilter) return false;
          if (patientFilter !== "all" && String(a.patient_id || "") !== patientFilter && String(a.secondary_patient_id || "") !== patientFilter) return false;
          return true;
        })
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()),
    [appointments, periodRange, providerFilter, patientFilter]
  );

  const filteredBlocks = useMemo(
    () =>
      blocks
        .filter((block) => {
          const d = new Date(block.start_time);
          const inRange = d >= periodRange.start && d <= periodRange.end;
          if (!inRange) return false;
          if (providerFilter === "all") return true;
          return String(block.provider_user_id) === providerFilter;
        })
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()),
    [blocks, periodRange, providerFilter]
  );

  const periodEntries = useMemo(
    () =>
      [
        ...filteredAppointments.map(
          (appointment) =>
            ({
              kind: "appointment",
              start_time: appointment.start_time,
              appointment,
            }) as DayEntry
        ),
        ...filteredBlocks.map(
          (block) =>
            ({
              kind: "block",
              start_time: block.start_time,
              block,
            }) as DayEntry
        ),
      ].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()),
    [filteredAppointments, filteredBlocks]
  );

  const periodLabel = useMemo(() => {
    if (viewMode === "day") {
      return selectedDate.toLocaleDateString("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
      });
    }

    if (viewMode === "week") {
      const start = getWeekStartMonday(selectedDate);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      return `${start.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} - ${end.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })}`;
    }

    return selectedDate
      .toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
      .replace(/^\w/, (c) => c.toUpperCase());
  }, [selectedDate, viewMode]);

  const canManageBlocks =
    me?.active_membership.role === "admin" || me?.active_membership.role === "professional";

  return (
    <div className="space-y-8">
      {feedback && (
        <div
          className={`px-4 py-3 rounded-xl border flex items-start gap-2 ${feedback.type === "success"
            ? "bg-success/10 text-success border-success/20"
            : "bg-error/10 text-error border-error/20"
            }`}
        >
          {feedback.type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span className="text-sm font-medium">{feedback.message}</span>
        </div>
      )}

      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Agenda</h2>
          <p className="text-slate-500">
            {filteredAppointments.length} sessoes e {filteredBlocks.length} bloqueios no periodo
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="bg-petroleum text-white px-6 py-3 rounded-2xl font-semibold shadow-lg shadow-petroleum/20 flex items-center gap-2 hover:scale-105 active:scale-95 transition-all"
        >
          <Plus size={20} />
          Agendar
        </button>
      </header>

      <div className="flex flex-wrap gap-3">
        <div className="inline-flex rounded-xl border border-black/10 bg-white/60 p-1">
          {[
            { id: "day", label: "Dia" },
            { id: "week", label: "Semana" },
            { id: "month", label: "Mês" },
          ].map((mode) => (
            <button
              key={mode.id}
              onClick={() => setViewMode(mode.id as AgendaViewMode)}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-semibold transition-all",
                viewMode === mode.id ? "bg-petroleum text-white shadow-sm" : "text-slate-600 hover:bg-white"
              )}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <select
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          className="apple-input max-w-sm appearance-none"
        >
          <option value="all">Todos os profissionais</option>
          {providers.map((provider) => (
            <option key={provider.user_id} value={provider.user_id}>
              {(provider.full_name || provider.email || provider.user_id) +
                ` (${provider.role === "admin" ? "Administrador" : "Profissional"})`}
            </option>
          ))}
        </select>
        <select
          value={patientFilter}
          onChange={(e) => setPatientFilter(e.target.value)}
          className="apple-input max-w-sm appearance-none"
        >
          <option value="all">Todos os pacientes</option>
          {patients.map((patient) => (
            <option key={patient.id} value={String(patient.id)}>
              {patient.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-4 glass-panel p-6 space-y-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSelectedDate(shiftDateByMode(selectedDate, viewMode, -1))}
              className="p-2 hover:bg-slate-100 rounded-lg"
            >
              <ChevronLeft size={20} className="text-slate-400" />
            </button>
            <h3 className="font-bold text-slate-700">{periodLabel}</h3>
            <button
              onClick={() => setSelectedDate(shiftDateByMode(selectedDate, viewMode, 1))}
              className="p-2 hover:bg-slate-100 rounded-lg"
            >
              <ChevronRight size={20} className="text-slate-400" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {calendarDays.map((day, idx) => {
              if (day === null) return <div key={`empty-${idx}`} className="h-10" />;
              const isSelected = day === selectedDate.getDate();
              return (
                <button
                  key={day}
                  onClick={() =>
                    setSelectedDate(
                      new Date(selectedDate.getFullYear(), selectedDate.getMonth(), day)
                    )
                  }
                  className={cn(
                    "h-10 w-10 rounded-full flex items-center justify-center text-sm",
                    isSelected
                      ? "bg-petroleum text-white shadow-lg shadow-petroleum/20"
                      : "hover:bg-slate-100 text-slate-600"
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-slate-500">Sessoes: 1h fixa. Recorrencia semanal/quinzenal/mensal.</p>
        </div>

        <div className="lg:col-span-8 space-y-4">
          {isLoading ? (
            <div className="glass-panel p-10 text-center text-slate-500">Carregando agenda...</div>
          ) : periodEntries.length === 0 ? (
            <div className="glass-panel p-10 text-center text-slate-500">
              Nenhum agendamento no periodo selecionado.
            </div>
          ) : (
            periodEntries.map((entry) => {
              if (entry.kind === "block") {
                const block = entry.block;
                const start = new Date(block.start_time);
                const end = new Date(block.end_time);
                return (
                  <motion.div
                    key={`block-${block.id}`}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="rounded-2xl border border-slate-300 bg-slate-100/90 p-5 flex items-center gap-6"
                  >
                    <div className="w-28 border-r border-slate-300 pr-6">
                      <p className="text-xl font-bold text-slate-700">
                        {start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </p>
                      <p className="text-xs font-semibold text-slate-500 mt-1">
                        ate {end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-bold text-slate-700">
                        {block.title || "Bloqueio de agenda externo"}
                      </h4>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-[10px] font-bold text-slate-700 bg-slate-200 px-2 py-0.5 rounded-md uppercase tracking-wider">
                          Bloqueio
                        </span>
                        <span className="text-[10px] font-bold text-slate-600 bg-white px-2 py-0.5 rounded-md uppercase tracking-wider">
                          {block.source === "google_external" ? "Google" : "Manual"}
                        </span>
                        {block.provider_name && (
                          <span className="text-[10px] font-bold text-slate-600 bg-white px-2 py-0.5 rounded-md">
                            {block.provider_name}
                          </span>
                        )}
                      </div>
                    </div>
                    {canManageBlocks && (
                      <button
                        onClick={() => deleteCalendarBlock(block)}
                        disabled={deletingId === Number(block.id)}
                        className="p-2 rounded-lg text-slate-500 hover:text-error hover:bg-error/10 disabled:opacity-50"
                        title="Excluir bloqueio"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </motion.div>
                );
              }

              const app = entry.appointment;
              const start = new Date(app.start_time);
              const names =
                app.session_type === "couple" && app.secondary_patient_name
                  ? `${app.patient_name || "Paciente"} + ${app.secondary_patient_name}`
                  : app.patient_name || "Paciente";

              return (
                <motion.div
                  key={app.id}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="glass-card p-6 flex items-center gap-8"
                >
                  <div className="w-24 border-r border-black/5 pr-6">
                    <p className="text-xl font-bold text-slate-800">
                      {start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">1h</p>
                  </div>

                  <div className="flex-1">
                    <h4 className="font-bold text-lg text-slate-800">{names}</h4>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[10px] font-bold text-petroleum bg-petroleum/10 px-2 py-0.5 rounded-md uppercase tracking-wider">
                        {app.session_type === "couple" ? "Casal" : "Individual"}
                      </span>
                      <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md uppercase tracking-wider flex items-center gap-1">
                        {app.session_mode === "online" ? <Video size={12} /> : <MapPin size={12} />}
                        {app.session_mode === "online" ? "Online" : "Presencial"}
                      </span>
                      {app.provider_name && (
                        <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                          {app.provider_name}
                        </span>
                      )}
                      {app.google_sync_status && (
                        <span
                          className={cn(
                            "text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider",
                            app.google_sync_status === "synced"
                              ? "bg-success/10 text-success"
                              : app.google_sync_status === "failed"
                                ? "bg-error/10 text-error"
                                : "bg-slate-200 text-slate-600"
                          )}
                        >
                          Google {app.google_sync_status === "synced" ? "ok" : app.google_sync_status}
                        </span>
                      )}
                      {app.online_meeting_url && app.session_mode === "online" && (
                        <a
                          href={app.online_meeting_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] font-bold text-petroleum flex items-center gap-1 hover:underline"
                        >
                          <Link2 size={12} /> Link
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEditModal(app)}
                      className="p-2 rounded-lg text-slate-500 hover:text-petroleum hover:bg-petroleum/10"
                      title="Editar"
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={() => deleteAppointment(app)}
                      disabled={deletingId === Number(app.id)}
                      className="p-2 rounded-lg text-slate-500 hover:text-error hover:bg-error/10 disabled:opacity-50"
                      title="Excluir"
                    >
                      <Trash2 size={16} />
                    </button>
                    <button
                      onClick={() =>
                        onStartSession({
                          id: String(app.patient_id),
                          name: String(app.patient_name || "Paciente"),
                        })
                      }
                      className="bg-success/10 text-success px-4 py-2 rounded-xl font-bold text-sm hover:bg-success hover:text-white transition-all"
                    >
                      Iniciar
                    </button>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-panel w-full max-w-2xl p-8 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-2xl font-bold">
                {!editingAppointment ? "Novo Agendamento" : "Editar Agendamento"}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <Plus size={24} className="rotate-45" />
              </button>
            </div>

            <form onSubmit={saveAppointment} className="space-y-5">
              {patientBlocked && (
                <div className="px-4 py-3 rounded-xl border border-warning/20 bg-warning/10 text-warning text-sm font-medium">
                  Paciente com pendencia financeira vencida. Novos agendamentos serao bloqueados.
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <select
                  required
                  value={form.provider_user_id}
                  onChange={(e) => setForm({ ...form, provider_user_id: e.target.value })}
                  className="apple-input appearance-none"
                >
                  <option value="">Profissional responsavel</option>
                  {providers.map((provider) => (
                    <option key={provider.user_id} value={provider.user_id}>
                      {provider.full_name || provider.email || provider.user_id}
                    </option>
                  ))}
                </select>

                <select
                  required
                  value={form.patient_id}
                  onChange={(e) => setForm({ ...form, patient_id: e.target.value })}
                  className="apple-input appearance-none"
                >
                  <option value="">Paciente principal</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>

                <select
                  value={form.session_type}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      session_type: e.target.value === "couple" ? "couple" : "individual",
                      secondary_patient_id: "",
                    })
                  }
                  className="apple-input appearance-none"
                >
                  <option value="individual">Individual</option>
                  <option value="couple">Casal</option>
                </select>
              </div>

              {form.session_type === "couple" && (
                <select
                  required
                  value={form.secondary_patient_id}
                  onChange={(e) => setForm({ ...form, secondary_patient_id: e.target.value })}
                  className="apple-input appearance-none"
                >
                  <option value="">Segundo paciente</option>
                  {patients
                    .filter((p) => String(p.id) !== form.patient_id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  required
                  type="datetime-local"
                  value={form.start_time}
                  onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                  className="apple-input"
                />
                <input value="Duracao fixa: 1h" disabled className="apple-input" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <select
                  value={form.session_mode}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      session_mode: e.target.value === "online" ? "online" : "in_person",
                      online_meeting_url: e.target.value === "online" ? form.online_meeting_url : "",
                    })
                  }
                  className="apple-input appearance-none"
                >
                  <option value="in_person">Presencial</option>
                  <option value="online">Online</option>
                </select>

                <select
                  value={form.status}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      status:
                        e.target.value === "completed" || e.target.value === "cancelled"
                          ? e.target.value
                          : "scheduled",
                    })
                  }
                  className="apple-input appearance-none"
                >
                  <option value="scheduled">Agendada</option>
                  <option value="completed">Concluida</option>
                  <option value="cancelled">Cancelada</option>
                </select>
              </div>

              {form.session_mode === "online" && (
                <input
                  type="url"
                  value={form.online_meeting_url}
                  onChange={(e) => setForm({ ...form, online_meeting_url: e.target.value })}
                  className="apple-input"
                  placeholder="Link online (opcional)"
                />
              )}

              {editingAppointment?.series_id && (
                <select
                  value={form.apply_scope}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      apply_scope:
                        e.target.value === "following" || e.target.value === "all"
                          ? e.target.value
                          : "single",
                    })
                  }
                  className="apple-input appearance-none"
                >
                  <option value="single">Editar somente esta</option>
                  <option value="following">Editar esta e próximas</option>
                  <option value="all">Editar toda série</option>
                </select>
              )}

              <div className="border border-black/10 rounded-xl p-4 space-y-3">
                <label className="inline-flex items-center gap-3 text-sm font-semibold text-slate-700 cursor-pointer">
                  <Switch
                    checked={form.recurrence_enabled}
                    onChange={(checked) =>
                      setForm({
                        ...form,
                        recurrence_enabled: checked,
                        recurrence_until_date: form.recurrence_until_date || toDateInput(selectedDate),
                      })
                    }
                  />
                  Sessão recorrente
                </label>
                {form.recurrence_enabled && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <select
                      value={form.recurrence_frequency}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          recurrence_frequency:
                            e.target.value === "biweekly" || e.target.value === "monthly"
                              ? e.target.value
                              : "weekly",
                        })
                      }
                      className="apple-input appearance-none"
                    >
                      <option value="weekly">Semanal</option>
                      <option value="biweekly">Quinzenal</option>
                      <option value="monthly">Mensal</option>
                    </select>
                    <input
                      required={form.recurrence_enabled}
                      type="date"
                      value={form.recurrence_until_date}
                      onChange={(e) => setForm({ ...form, recurrence_until_date: e.target.value })}
                      className="apple-input"
                    />
                  </div>
                )}
              </div>

              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="apple-input w-full resize-none"
                placeholder="Observacoes"
              />

              <div className="flex justify-end gap-4 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-6 py-3 rounded-xl font-semibold text-slate-500 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="bg-petroleum text-white px-8 py-3 rounded-xl font-semibold shadow-lg shadow-petroleum/20 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isSaving ? "Salvando..." : !editingAppointment ? "Agendar" : "Salvar"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};
