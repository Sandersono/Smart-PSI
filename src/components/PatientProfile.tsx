import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  BookOpenText,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock3,
  DollarSign,
  FileText,
  FolderOpen,
  Mail,
  Phone,
  Plus,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  User,
} from "lucide-react";
import { motion } from "motion/react";
import { cn } from "../lib/utils";
import { ApiError, apiRequest } from "../lib/api";
import { formatLocalMonthInput } from "../lib/date";
import { Appointment, FinancialRecord, Patient, UserRole } from "../lib/types";

interface PatientProfileProps {
  accessToken: string;
  patient: Patient;
  role: UserRole;
  onBack: () => void;
  onNewSession: (patientId: string) => void;
}

type Feedback = { type: "success" | "error"; message: string } | null;

type HistoryNote = {
  id: number;
  complaint: string | null;
  intervention: string | null;
  next_focus: string | null;
  status: "draft" | "final";
  created_at: string;
};

type PatientHistory = {
  notes: HistoryNote[];
  appointments: Appointment[];
  financial: FinancialRecord[];
};

type MonthlySummary = {
  period: string;
  outstanding_amount: number;
  gross_amount: number;
  paid_amount: number;
  session_count: number;
};

type PatientSection =
  | "principal"
  | "cadastro"
  | "anamnese"
  | "sessoes"
  | "prontuario"
  | "financeiro"
  | "documentos"
  | "preferencias";

type PatientForm = {
  name: string;
  email: string;
  phone: string;
  birth_date: string;
  cpf: string;
  address: string;
};

type PreferencesForm = {
  session_fee: string;
  billing_mode_override: "default" | "session" | "monthly";
};

const emptyHistory: PatientHistory = {
  notes: [],
  appointments: [],
  financial: [],
};

function toDateInputOrEmpty(value: string | null | undefined) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export const PatientProfile = ({
  accessToken,
  patient,
  role,
  onBack,
  onNewSession,
}: PatientProfileProps) => {
  const [patientData, setPatientData] = useState<Patient>(patient);
  const [history, setHistory] = useState<PatientHistory>(emptyHistory);
  const [activeSection, setActiveSection] = useState<PatientSection>("principal");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [monthlySummary, setMonthlySummary] = useState<MonthlySummary | null>(null);
  const [sessionStartDate, setSessionStartDate] = useState<string>("");
  const [sessionEndDate, setSessionEndDate] = useState<string>("");
  const canAccessClinical = role !== "secretary";

  const [patientForm, setPatientForm] = useState<PatientForm>({
    name: patient.name || "",
    email: patient.email || "",
    phone: patient.phone || "",
    birth_date: toDateInputOrEmpty(patient.birth_date),
    cpf: patient.cpf || "",
    address: patient.address || "",
  });
  const [anamneseText, setAnamneseText] = useState(String(patient.anamnese || ""));
  const [prontuarioText, setProntuarioText] = useState(String(patient.notes || ""));
  const [preferencesForm, setPreferencesForm] = useState<PreferencesForm>({
    session_fee: String(Number(patient.session_fee || 0)),
    billing_mode_override:
      patient.billing_mode_override === "session" || patient.billing_mode_override === "monthly"
        ? patient.billing_mode_override
        : "default",
  });

  useEffect(() => {
    setPatientData(patient);
    setPatientForm({
      name: patient.name || "",
      email: patient.email || "",
      phone: patient.phone || "",
      birth_date: toDateInputOrEmpty(patient.birth_date),
      cpf: patient.cpf || "",
      address: patient.address || "",
    });
    setAnamneseText(String(patient.anamnese || ""));
    setProntuarioText(String(patient.notes || ""));
    setPreferencesForm({
      session_fee: String(Number(patient.session_fee || 0)),
      billing_mode_override:
        patient.billing_mode_override === "session" || patient.billing_mode_override === "monthly"
          ? patient.billing_mode_override
          : "default",
    });
  }, [patient]);

  useEffect(() => {
    fetchHistory();
  }, [patient?.id, accessToken]);

  useEffect(() => {
    fetchMonthlySummary();
  }, [patient?.id, accessToken]);

  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(() => setFeedback(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  useEffect(() => {
    if (canAccessClinical) return;
    if (activeSection === "anamnese" || activeSection === "prontuario") {
      setActiveSection("principal");
    }
  }, [canAccessClinical, activeSection]);

  const fetchHistory = async () => {
    setIsLoading(true);
    try {
      const data = await apiRequest<PatientHistory>(`/api/patients/${patient.id}/history`, accessToken);
      setHistory(data || emptyHistory);
    } catch (error) {
      console.error("Failed to load patient history", error);
      setFeedback({ type: "error", message: "Falha ao carregar histórico do paciente." });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchMonthlySummary = async () => {
    if (!patient?.id) {
      setMonthlySummary(null);
      return;
    }

    const month = formatLocalMonthInput();
    try {
      const data = await apiRequest<MonthlySummary>(
        `/api/financial/patient/${patient.id}/monthly-summary?month=${month}`,
        accessToken
      );
      setMonthlySummary(data);
    } catch (error) {
      console.error("Failed to load patient monthly summary", error);
      setMonthlySummary(null);
    }
  };

  const persistPatient = async (
    override: Partial<{
      name: string;
      email: string | null;
      phone: string | null;
      birth_date: string | null;
      cpf: string | null;
      address: string | null;
      notes: string | null;
      anamnese: string | null;
      session_fee: number;
      billing_mode_override: "session" | "monthly" | null;
    }>,
    successMessage: string
  ) => {
    const payload: Record<string, unknown> = {
      name: override.name ?? patientData.name,
      email: override.email ?? patientData.email,
      phone: override.phone ?? patientData.phone,
      birth_date: override.birth_date ?? patientData.birth_date,
      cpf: override.cpf ?? patientData.cpf,
      address: override.address ?? patientData.address,
      session_fee:
        override.session_fee !== undefined
          ? override.session_fee
          : Number(patientData.session_fee || 0),
      billing_mode_override:
        override.billing_mode_override !== undefined
          ? override.billing_mode_override
          : patientData.billing_mode_override,
    };

    if (canAccessClinical) {
      payload.notes = override.notes !== undefined ? override.notes : patientData.notes;
      payload.anamnese = override.anamnese !== undefined ? override.anamnese : patientData.anamnese;
    }

    await apiRequest<{ id: number }>(`/api/patients/${patientData.id}`, accessToken, {
      method: "PUT",
      body: JSON.stringify(payload),
    });

    setPatientData((prev) => ({
      ...prev,
      name: String(payload.name || ""),
      email: (payload.email as string | null) ?? null,
      phone: (payload.phone as string | null) ?? null,
      birth_date: (payload.birth_date as string | null) ?? null,
      cpf: (payload.cpf as string | null) ?? null,
      address: (payload.address as string | null) ?? null,
      notes: canAccessClinical ? ((payload.notes as string | null) ?? null) : prev.notes,
      anamnese: canAccessClinical ? ((payload.anamnese as string | null) ?? null) : prev.anamnese,
      session_fee: Number(payload.session_fee || 0),
      billing_mode_override: (payload.billing_mode_override as "session" | "monthly" | null) ?? null,
    }));

    setFeedback({ type: "success", message: successMessage });
  };

  const handleSaveCadastro = async () => {
    if (!patientForm.name.trim()) {
      setFeedback({ type: "error", message: "Nome do paciente é obrigatório." });
      return;
    }
    setIsSaving(true);
    try {
      await persistPatient(
        {
          name: patientForm.name.trim(),
          email: patientForm.email.trim() || null,
          phone: patientForm.phone.trim() || null,
          birth_date: patientForm.birth_date || null,
          cpf: patientForm.cpf.trim() || null,
          address: patientForm.address.trim() || null,
        },
        "Cadastro do paciente atualizado."
      );
    } catch (error: unknown) {
      setFeedback({
        type: "error",
        message: error instanceof ApiError ? error.message : "Falha ao salvar cadastro.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAnamnese = async () => {
    if (!canAccessClinical) return;
    setIsSaving(true);
    try {
      await persistPatient({ anamnese: anamneseText.trim() || null }, "Anamnese atualizada.");
    } catch (error: unknown) {
      setFeedback({
        type: "error",
        message: error instanceof ApiError ? error.message : "Falha ao salvar anamnese.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveProntuario = async () => {
    if (!canAccessClinical) return;
    setIsSaving(true);
    try {
      await persistPatient({ notes: prontuarioText.trim() || null }, "Prontuário clínico atualizado.");
    } catch (error: unknown) {
      setFeedback({
        type: "error",
        message: error instanceof ApiError ? error.message : "Falha ao salvar prontuário clínico.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSavePreferencias = async () => {
    const fee = Number(preferencesForm.session_fee || 0);
    if (!Number.isFinite(fee) || fee < 0) {
      setFeedback({ type: "error", message: "Valor por sessão inválido." });
      return;
    }
    setIsSaving(true);
    try {
      await persistPatient(
        {
          session_fee: fee,
          billing_mode_override:
            preferencesForm.billing_mode_override === "default"
              ? null
              : preferencesForm.billing_mode_override,
        },
        "Preferências financeiras atualizadas."
      );
    } catch (error: unknown) {
      setFeedback({
        type: "error",
        message: error instanceof ApiError ? error.message : "Falha ao salvar preferências.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const exportPatientJson = () => {
    const content = JSON.stringify(
      {
        paciente: patientData,
        historico: history,
        resumo_mensal: monthlySummary,
      },
      null,
      2
    );
    downloadFile(`paciente-${patientData.id}-historico.json`, content, "application/json;charset=utf-8");
  };

  const exportPatientText = () => {
    const lines = [
      `Paciente: ${patientData.name}`,
      `Email: ${patientData.email || "-"}`,
      `Telefone: ${patientData.phone || "-"}`,
      `CPF: ${patientData.cpf || "-"}`,
      `Sessões registradas: ${history.appointments.length}`,
      `Registros de prontuário: ${history.notes.length}`,
      `Lançamentos financeiros: ${history.financial.length}`,
      "",
      "Prontuário clínico:",
      prontuarioText || "Sem texto complementar.",
      "",
      "Anamnese:",
      anamneseText || "Sem anamnese registrada.",
    ];
    downloadFile(`paciente-${patientData.id}-resumo.txt`, lines.join("\n"), "text/plain;charset=utf-8");
  };

  const totalPaid = history.financial
    .filter((f) => f.type === "income")
    .reduce((acc, f) => acc + Number(f.amount || 0), 0);

  const orderedAppointments = useMemo(
    () =>
      [...history.appointments].sort(
        (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
      ),
    [history.appointments]
  );

  const filteredAppointments = useMemo(() => {
    return orderedAppointments.filter((app) => {
      const d = new Date(app.start_time);
      if (sessionStartDate && d < new Date(sessionStartDate + "T00:00:00")) return false;
      if (sessionEndDate && d > new Date(sessionEndDate + "T23:59:59")) return false;
      return true;
    });
  }, [orderedAppointments, sessionStartDate, sessionEndDate]);

  const nextAppointment = useMemo(
    () =>
      [...history.appointments]
        .filter((item) => new Date(item.start_time).getTime() > Date.now())
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())[0] || null,
    [history.appointments]
  );

  const sectionItems = [
    { id: "principal", label: "Principal", icon: Activity },
    { id: "cadastro", label: "Cadastro", icon: User },
    ...(canAccessClinical
      ? [
        { id: "anamnese", label: "Anamnese", icon: ClipboardList },
        { id: "prontuario", label: "Prontuário", icon: BookOpenText },
      ]
      : []),
    { id: "sessoes", label: "Sessões", icon: Clock3 },
    { id: "financeiro", label: "Financeiro", icon: DollarSign },
    { id: "documentos", label: "Documentos", icon: FolderOpen },
    { id: "preferencias", label: "Preferências", icon: SlidersHorizontal },
  ] as const;

  const renderPrincipal = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-card p-5">
          <p className="text-xs uppercase tracking-wider text-slate-500 font-bold">Sessões</p>
          <p className="text-2xl font-bold text-petroleum mt-2">{history.appointments.length}</p>
        </div>
        <div className="glass-card p-5">
          <p className="text-xs uppercase tracking-wider text-slate-500 font-bold">Em Aberto (Mês)</p>
          <p className="text-2xl font-bold text-error mt-2">
            R$ {Number(monthlySummary?.outstanding_amount || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="glass-card p-5">
          <p className="text-xs uppercase tracking-wider text-slate-500 font-bold">Total Recebido</p>
          <p className="text-2xl font-bold text-success mt-2">
            R$ {totalPaid.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      <div className="glass-panel p-6 space-y-4">
        <h3 className="text-xl font-bold">Próxima sessão</h3>
        {nextAppointment ? (
          <div className="rounded-xl border border-black/10 p-4 bg-white/70 flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-slate-800">
                {new Date(nextAppointment.start_time).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
              <p className="text-sm text-slate-500 mt-1">
                Status: {nextAppointment.status === "scheduled" ? "Agendada" : nextAppointment.status}
              </p>
            </div>
            <button
              onClick={() => onNewSession(String(patientData.id))}
              className="bg-petroleum text-white px-4 py-2 rounded-xl font-semibold"
            >
              Iniciar sessão
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Nenhuma sessão futura encontrada.</p>
        )}
      </div>

      {canAccessClinical && (
        <div className="glass-panel p-6 space-y-3">
          <h3 className="text-xl font-bold">Resumo rápido do prontuário</h3>
          <p className="text-sm text-slate-600 whitespace-pre-wrap">
            {prontuarioText || "Nenhum texto complementar de prontuário registrado."}
          </p>
        </div>
      )}
    </div>
  );

  const renderCadastro = () => (
    <div className="glass-panel p-6 space-y-5">
      <h3 className="text-xl font-bold">Cadastro do paciente</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <input
          className="apple-input"
          placeholder="Nome completo"
          value={patientForm.name}
          onChange={(e) => setPatientForm((prev) => ({ ...prev, name: e.target.value }))}
        />
        <input
          className="apple-input"
          placeholder="E-mail"
          value={patientForm.email}
          onChange={(e) => setPatientForm((prev) => ({ ...prev, email: e.target.value }))}
        />
        <input
          className="apple-input"
          placeholder="Telefone"
          value={patientForm.phone}
          onChange={(e) => setPatientForm((prev) => ({ ...prev, phone: e.target.value }))}
        />
        <input
          type="date"
          className="apple-input"
          value={patientForm.birth_date}
          onChange={(e) => setPatientForm((prev) => ({ ...prev, birth_date: e.target.value }))}
        />
        <input
          className="apple-input"
          placeholder="CPF"
          value={patientForm.cpf}
          onChange={(e) => setPatientForm((prev) => ({ ...prev, cpf: e.target.value }))}
        />
        <input
          className="apple-input"
          placeholder="Endereço"
          value={patientForm.address}
          onChange={(e) => setPatientForm((prev) => ({ ...prev, address: e.target.value }))}
        />
      </div>
      <button
        disabled={isSaving}
        onClick={handleSaveCadastro}
        className="bg-petroleum text-white px-6 py-3 rounded-xl font-semibold disabled:opacity-60"
      >
        Salvar cadastro
      </button>
    </div>
  );

  const renderAnamnese = () => (
    <div className="glass-panel p-6 space-y-4">
      <h3 className="text-xl font-bold">Anamnese</h3>
      {!canAccessClinical ? (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-warning text-sm">
          Perfil secretaria: anamnese indisponível por permissão.
        </div>
      ) : (
        <>
          <textarea
            rows={12}
            value={anamneseText}
            onChange={(e) => setAnamneseText(e.target.value)}
            className="apple-input w-full resize-none"
            placeholder="Registre dados iniciais de anamnese, contexto clínico e histórico relevante."
          />
          <button
            disabled={isSaving}
            onClick={handleSaveAnamnese}
            className="bg-petroleum text-white px-6 py-3 rounded-xl font-semibold disabled:opacity-60"
          >
            Salvar anamnese
          </button>
        </>
      )}
    </div>
  );

  const renderSessoes = () => (
    <div className="space-y-4">
      <div className="flex gap-4 mb-2">
        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Data Inicial</label>
          <input
            type="date"
            value={sessionStartDate}
            onChange={(e) => setSessionStartDate(e.target.value)}
            className="apple-input bg-white text-sm py-2 px-3"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Data Final</label>
          <input
            type="date"
            value={sessionEndDate}
            onChange={(e) => setSessionEndDate(e.target.value)}
            className="apple-input bg-white text-sm py-2 px-3"
          />
        </div>
        {(sessionStartDate || sessionEndDate) && (
          <div className="flex items-end">
            <button
              onClick={() => {
                setSessionStartDate("");
                setSessionEndDate("");
              }}
              className="text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors mb-2"
            >
              Limpar
            </button>
          </div>
        )}
      </div>

      {filteredAppointments.length === 0 ? (
        <div className="glass-panel p-10 text-center text-slate-500">Nenhuma sessão registrada para o periodo.</div>
      ) : (
        filteredAppointments.map((appointment) => (
          <motion.div
            key={appointment.id}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            className="glass-card p-5 flex items-center justify-between gap-4"
          >
            <div>
              <p className="font-semibold text-slate-800">
                {new Date(appointment.start_time).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {appointment.session_type === "couple" ? "Sessão de casal" : "Sessão individual"} | {" "}
                {appointment.session_mode === "online" ? "Online" : "Presencial"}
              </p>
              {appointment.notes && <p className="text-sm text-slate-600 mt-2">{appointment.notes}</p>}
            </div>
            <span className={cn(
              "text-xs font-bold px-3 py-1 rounded-full uppercase border",
              appointment.status === "scheduled" ? "bg-slate-100 text-slate-700 border-transparent" :
                appointment.status === "completed" ? "bg-success/10 text-success border-success/20" :
                  appointment.status === "cancelled" ? "bg-error/10 text-error border-error/20" :
                    "bg-warning/10 text-warning border-warning/20"
            )}>
              {appointment.status === "scheduled"
                ? "Agendada"
                : appointment.status === "completed"
                  ? "Concluída"
                  : appointment.status === "cancelled"
                    ? "Cancelada"
                    : "Remarcada"}
            </span>
          </motion.div>
        ))
      )}
    </div>
  );

  const renderProntuario = () => (
    <div className="space-y-5">
      <div className="glass-panel p-6 space-y-4">
        <h3 className="text-xl font-bold">Prontuário psicológico</h3>
        {!canAccessClinical ? (
          <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-warning text-sm">
            Perfil secretaria: prontuário clínico indisponível por permissão.
          </div>
        ) : (
          <>
            <textarea
              rows={8}
              value={prontuarioText}
              onChange={(e) => setProntuarioText(e.target.value)}
              className="apple-input w-full resize-none"
              placeholder="Anotações gerais e evolução clínica do paciente."
            />
            <button
              disabled={isSaving}
              onClick={handleSaveProntuario}
              className="bg-petroleum text-white px-6 py-3 rounded-xl font-semibold disabled:opacity-60"
            >
              Salvar prontuário
            </button>
          </>
        )}
      </div>

      <div className="space-y-4">
        {history.notes.length === 0 ? (
          <div className="glass-panel p-10 text-center text-slate-500">Nenhum registro de sessão encontrado.</div>
        ) : (
          history.notes.map((note) => (
            <div key={note.id} className="glass-card p-5 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-slate-700">Sessão #{note.id}</p>
                <p className="text-xs text-slate-500">
                  {new Date(note.created_at).toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}
                </p>
              </div>
              <p className="text-sm text-slate-600"><strong>Queixa:</strong> {note.complaint || "-"}</p>
              <p className="text-sm text-slate-600"><strong>Intervenção:</strong> {note.intervention || "-"}</p>
              <p className="text-sm text-slate-600"><strong>Próximo foco:</strong> {note.next_focus || "-"}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderFinanceiro = () => (
    <div className="space-y-4">
      {history.financial.length === 0 ? (
        <div className="glass-panel p-10 text-center text-slate-500">Nenhum registro financeiro encontrado.</div>
      ) : (
        history.financial.map((record) => (
          <div key={record.id} className="glass-card p-5 flex items-center justify-between">
            <div>
              <p className="font-semibold text-slate-700">{record.description || "Lançamento financeiro"}</p>
              <p className="text-xs text-slate-500 mt-1">
                {new Date(record.date).toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </p>
            </div>
            <p className={cn("font-bold", record.type === "income" ? "text-success" : "text-error")}>
              {record.type === "income" ? "+" : "-"}R${" "}
              {Number(record.amount || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </p>
          </div>
        ))
      )}
    </div>
  );

  const renderDocumentos = () => (
    <div className="glass-panel p-6 space-y-4">
      <h3 className="text-xl font-bold">Documentos e exportações</h3>
      <p className="text-sm text-slate-500">
        Exporte rapidamente o histórico para compartilhamento interno, auditoria e backup do atendimento.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          onClick={exportPatientJson}
          className="bg-petroleum text-white px-5 py-2.5 rounded-xl font-semibold"
        >
          Exportar histórico (JSON)
        </button>
        <button
          onClick={exportPatientText}
          className="border border-petroleum text-petroleum px-5 py-2.5 rounded-xl font-semibold"
        >
          Exportar resumo (TXT)
        </button>
      </div>
    </div>
  );

  const renderPreferencias = () => (
    <div className="glass-panel p-6 space-y-5">
      <h3 className="text-xl font-bold">Preferências de cobrança</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Valor por sessão (R$)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={preferencesForm.session_fee}
            onChange={(e) => setPreferencesForm((prev) => ({ ...prev, session_fee: e.target.value }))}
            className="apple-input w-full"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Modo de cobrança</label>
          <select
            value={preferencesForm.billing_mode_override}
            onChange={(e) =>
              setPreferencesForm((prev) => ({
                ...prev,
                billing_mode_override:
                  e.target.value === "session" || e.target.value === "monthly"
                    ? e.target.value
                    : "default",
              }))
            }
            className="apple-input w-full appearance-none"
          >
            <option value="default">Padrão da clínica</option>
            <option value="session">Por sessão</option>
            <option value="monthly">Mensal consolidado</option>
          </select>
        </div>
      </div>
      <button
        disabled={isSaving}
        onClick={handleSavePreferencias}
        className="bg-petroleum text-white px-6 py-3 rounded-xl font-semibold disabled:opacity-60"
      >
        Salvar preferências
      </button>
    </div>
  );

  const renderSection = () => {
    if (isLoading && activeSection !== "cadastro" && activeSection !== "preferencias") {
      return <div className="glass-panel p-10 text-center text-slate-500">Carregando informações...</div>;
    }

    if (activeSection === "principal") return renderPrincipal();
    if (activeSection === "cadastro") return renderCadastro();
    if (activeSection === "anamnese") return renderAnamnese();
    if (activeSection === "sessoes") return renderSessoes();
    if (activeSection === "prontuario") return renderProntuario();
    if (activeSection === "financeiro") return renderFinanceiro();
    if (activeSection === "documentos") return renderDocumentos();
    return renderPreferencias();
  };

  return (
    <div className="space-y-6">
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

      <header className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-slate-500 hover:text-petroleum transition-colors"
        >
          <ArrowLeft size={20} />
          Voltar para pacientes
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSection("sessoes")}
            className="border border-petroleum/30 text-petroleum px-4 py-2.5 rounded-xl font-semibold"
          >
            Ver sessões
          </button>
          <button
            onClick={() => onNewSession(String(patientData.id))}
            className="bg-petroleum text-white px-5 py-2.5 rounded-xl font-semibold flex items-center gap-2"
          >
            <Plus size={18} />
            Agendar sessão
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <aside className="lg:col-span-3 space-y-4">
          <div className="glass-panel p-5 space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-petroleum/10 text-petroleum flex items-center justify-center">
              <User size={34} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">{patientData.name}</h2>
              <p className="text-xs text-slate-500 mt-1">
                Cadastro em {new Date(patientData.created_at).toLocaleDateString("pt-BR")}
              </p>
            </div>
            <div className="space-y-2 text-xs text-slate-600">
              <p className="flex items-center gap-2"><Mail size={13} /> {patientData.email || "Sem e-mail"}</p>
              <p className="flex items-center gap-2"><Phone size={13} /> {patientData.phone || "Sem telefone"}</p>
              <p className="flex items-center gap-2"><Calendar size={13} /> {patientData.birth_date ? new Date(patientData.birth_date).toLocaleDateString("pt-BR") : "Sem data de nascimento"}</p>
            </div>
          </div>

          <nav className="glass-panel p-3 space-y-1">
            {sectionItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id as PatientSection)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all",
                  activeSection === item.id
                    ? "bg-petroleum/10 text-petroleum"
                    : "text-slate-600 hover:bg-slate-100"
                )}
              >
                <item.icon size={16} />
                {item.label}
              </button>
            ))}
          </nav>

          {canAccessClinical ? (
            <div className="glass-panel p-4 bg-petroleum text-white border-none">
              <p className="text-xs uppercase tracking-wider text-white/70 font-bold mb-1">Acesso clínico</p>
              <p className="text-sm font-medium flex items-center gap-2">
                <ShieldCheck size={14} />
                Perfil habilitado para prontuário e anamnese
              </p>
            </div>
          ) : (
            <div className="glass-panel p-4 border border-warning/20 bg-warning/10 text-warning text-sm">
              Perfil secretaria: acesso cl�nico restrito.
            </div>
          )}
        </aside>

        <section className="lg:col-span-9">{renderSection()}</section>
      </div>
    </div>
  );
};
