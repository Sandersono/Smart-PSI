import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  Calendar,
  FileText,
  DollarSign,
  Plus,
  Activity,
  ShieldCheck,
  Edit,
  CheckCircle2,
  AlertCircle,
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

const emptyHistory: PatientHistory = {
  notes: [],
  appointments: [],
  financial: [],
};

type TimelineCardItem =
  | { event_type: "note"; date: string; note: HistoryNote }
  | { event_type: "appointment"; date: string; appointment: Appointment }
  | { event_type: "financial"; date: string; record: FinancialRecord };

export const PatientProfile = ({
  accessToken,
  patient,
  role,
  onBack,
  onNewSession,
}: PatientProfileProps) => {
  const [patientData, setPatientData] = useState<Patient>(patient);
  const [history, setHistory] = useState<PatientHistory>(emptyHistory);
  const [activeTab, setActiveTab] = useState<"timeline" | "notes" | "financial">("timeline");
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [isClinicalModalOpen, setIsClinicalModalOpen] = useState(false);
  const [clinicalNotes, setClinicalNotes] = useState(String(patient?.notes || ""));
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [monthlySummary, setMonthlySummary] = useState<MonthlySummary | null>(null);
  const canAccessClinical = role !== "secretary";

  useEffect(() => {
    setPatientData(patient);
    setClinicalNotes(String(patient?.notes || ""));
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
    if (!canAccessClinical && activeTab === "notes") {
      setActiveTab("timeline");
    }
  }, [activeTab, canAccessClinical]);

  const fetchHistory = async () => {
    setIsLoading(true);
    try {
      const data = await apiRequest<PatientHistory>(`/api/patients/${patient.id}/history`, accessToken);
      setHistory(data || emptyHistory);
    } catch (error) {
      console.error("Failed to load patient history", error);
      setFeedback({ type: "error", message: "Falha ao carregar historico do paciente." });
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

  const handleSaveClinicalNotes = async () => {
    if (!canAccessClinical) return;
    setIsSavingNotes(true);
    try {
      await apiRequest<{ id: number }>(`/api/patients/${patientData.id}`, accessToken, {
        method: "PUT",
        body: JSON.stringify({
          name: patientData.name,
          email: patientData.email,
          phone: patientData.phone,
          birth_date: patientData.birth_date,
          cpf: patientData.cpf,
          address: patientData.address,
          notes: clinicalNotes,
        }),
      });
      setPatientData((prev) => ({ ...prev, notes: clinicalNotes }));
      setIsClinicalModalOpen(false);
      setFeedback({ type: "success", message: "Observacoes clinicas atualizadas." });
    } catch (error: unknown) {
      console.error("Failed to save patient clinical notes", error);
      setFeedback({
        type: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "Falha ao salvar observacoes clinicas.",
      });
    } finally {
      setIsSavingNotes(false);
    }
  };

  const totalPaid = history.financial
    .filter((f) => f.type === "income")
    .reduce((acc, f) => acc + Number(f.amount || 0), 0);

  const timelineItems = useMemo<TimelineCardItem[]>(() => {
    const items = [
      ...history.notes.map((note) => ({
        event_type: "note" as const,
        date: note.created_at,
        note,
      })),
      ...history.appointments.map((appointment) => ({
        event_type: "appointment" as const,
        date: appointment.start_time,
        appointment,
      })),
      ...history.financial.map((record) => ({
        event_type: "financial" as const,
        date: record.date,
        record,
      })),
    ];
    return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [history]);

  return (
    <div className="space-y-8">
      {feedback && (
        <div
          className={`px-4 py-3 rounded-xl border flex items-start gap-2 ${
            feedback.type === "success"
              ? "bg-success/10 text-success border-success/20"
              : "bg-error/10 text-error border-error/20"
          }`}
        >
          {feedback.type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span className="text-sm font-medium">{feedback.message}</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-slate-500 hover:text-petroleum transition-colors"
        >
          <ArrowLeft size={20} />
          Voltar para pacientes
        </button>
        <button
          onClick={() => onNewSession(String(patientData.id))}
          className="bg-petroleum text-white px-6 py-3 rounded-2xl font-semibold shadow-lg shadow-petroleum/20 flex items-center gap-2 hover:scale-105 active:scale-95 transition-all"
        >
          <Plus size={20} />
          Nova sessao
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <div className="glass-panel p-8 text-center space-y-6">
            <div className="w-24 h-24 bg-petroleum/10 rounded-[2rem] flex items-center justify-center text-petroleum mx-auto shadow-inner">
              <User size={48} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-800">{patientData.name}</h2>
              <p className="text-slate-500 font-medium">
                Paciente desde {new Date(patientData.created_at).toLocaleDateString("pt-BR")}
              </p>
            </div>

            <div className="space-y-4 text-left pt-6 border-t border-black/5">
              <div className="flex items-center gap-3 text-slate-600">
                <Mail size={18} className="text-slate-400" />
                <span className="text-sm truncate">{patientData.email || "Nao informado"}</span>
              </div>
              <div className="flex items-center gap-3 text-slate-600">
                <Phone size={18} className="text-slate-400" />
                <span className="text-sm">{patientData.phone || "Nao informado"}</span>
              </div>
              <div className="flex items-center gap-3 text-slate-600">
                <Calendar size={18} className="text-slate-400" />
                <span className="text-sm">
                  {patientData.birth_date
                    ? new Date(patientData.birth_date).toLocaleDateString("pt-BR")
                    : "Nao informado"}
                </span>
              </div>
            </div>

            <div className="pt-6 border-t border-black/5 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="text-center">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                  Sessoes
                </p>
                <p className="text-xl font-bold text-petroleum">{history.notes.length}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                  Total recebido
                </p>
                <p className="text-xl font-bold text-success">
                  R$ {totalPaid.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="text-center">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                  Em aberto (mes)
                </p>
                <p className="text-xl font-bold text-error">
                  R${" "}
                  {Number(monthlySummary?.outstanding_amount || 0).toLocaleString("pt-BR", {
                    minimumFractionDigits: 2,
                  })}
                </p>
              </div>
            </div>
          </div>

          {canAccessClinical ? (
            <div className="glass-panel p-6 bg-petroleum text-white border-none">
              <h3 className="font-bold mb-4 flex items-center gap-2">
                <ShieldCheck size={18} />
                Observacoes clinicas
              </h3>
              <p className="text-sm text-white/70 leading-relaxed whitespace-pre-wrap">
                {patientData.notes || "Nenhuma observacao clinica registrada."}
              </p>
              <button
                onClick={() => setIsClinicalModalOpen(true)}
                className="mt-6 w-full bg-white/10 hover:bg-white/20 text-white py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
              >
                <Edit size={14} />
                Editar prontuario
              </button>
            </div>
          ) : (
            <div className="glass-panel p-6 border border-warning/20 bg-warning/10 text-warning">
              Perfil de secretaria: prontuario clinico oculto por permissao.
            </div>
          )}
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="flex bg-white/40 backdrop-blur-md p-1 rounded-2xl border border-white/60 w-fit">
            {[
              { id: "timeline", label: "Linha do tempo", icon: Activity },
              ...(canAccessClinical
                ? ([{ id: "notes", label: "Notas clinicas", icon: FileText }] as const)
                : []),
              { id: "financial", label: "Financeiro", icon: DollarSign },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as "timeline" | "notes" | "financial")}
                className={cn(
                  "flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all",
                  activeTab === tab.id ? "bg-white text-petroleum shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                <tab.icon size={16} />
                {tab.label}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="glass-panel p-10 text-center text-slate-500">Carregando historico...</div>
          ) : (
            <div className="space-y-4">
              {activeTab === "timeline" &&
                timelineItems.map((item, idx) => (
                  <TimelineCard
                    key={`${item.event_type}-${item.date}-${idx}`}
                    item={item}
                    index={idx}
                  />
                ))}

              {activeTab === "notes" &&
                history.notes.map((note, idx) => (
                  <NoteCard key={`note-${note.id}-${idx}`} note={note} index={idx} />
                ))}

              {activeTab === "financial" &&
                history.financial.map((record, idx) => (
                  <FinancialCard key={`fin-${record.id}-${idx}`} record={record} index={idx} />
                ))}

              {activeTab === "timeline" && timelineItems.length === 0 && (
                <div className="py-16 text-center glass-panel text-slate-400">
                  Nenhuma atividade registrada para este paciente.
                </div>
              )}

              {activeTab === "notes" && history.notes.length === 0 && (
                <div className="py-16 text-center glass-panel text-slate-400">
                  Nenhuma nota clinica encontrada.
                </div>
              )}

              {activeTab === "financial" && history.financial.length === 0 && (
                <div className="py-16 text-center glass-panel text-slate-400">
                  Nenhum registro financeiro encontrado.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {canAccessClinical && isClinicalModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-panel w-full max-w-xl p-8 space-y-6"
          >
            <h3 className="text-2xl font-bold">Editar observacoes clinicas</h3>
            <textarea
              rows={8}
              value={clinicalNotes}
              onChange={(e) => setClinicalNotes(e.target.value)}
              className="apple-input w-full resize-none"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setIsClinicalModalOpen(false)}
                className="px-6 py-2.5 rounded-xl font-semibold text-slate-600 hover:bg-slate-100 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveClinicalNotes}
                disabled={isSavingNotes}
                className="bg-petroleum text-white px-6 py-2.5 rounded-xl font-semibold shadow-lg shadow-petroleum/20 hover:scale-105 active:scale-95 transition-all disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                {isSavingNotes ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

const TimelineCard = ({ item, index }: { item: TimelineCardItem; index: number }) => (
  <motion.div
    initial={{ opacity: 0, x: 20 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ delay: index * 0.04 }}
    className="glass-card p-6 space-y-3"
  >
    <div className="flex items-center justify-between">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
        {item.event_type === "note"
          ? "Nota clinica"
          : item.event_type === "appointment"
          ? "Agendamento"
          : "Financeiro"}
      </p>
      <p className="text-xs text-slate-500">
        {new Date(item.date).toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })}
      </p>
    </div>
    {item.event_type === "note" && (
      <p className="text-sm text-slate-600">
        <strong>Queixa:</strong> {item.note.complaint || "-"}
      </p>
    )}
    {item.event_type === "appointment" && (
      <p className="text-sm text-slate-600">
        Sessao em{" "}
        {new Date(item.appointment.start_time).toLocaleString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })}
        .
      </p>
    )}
    {item.event_type === "financial" && (
      <p className="text-sm text-slate-600">
        {item.record.type === "income" ? "Recebimento" : "Despesa"} de R${" "}
        {Number(item.record.amount || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}.
      </p>
    )}
  </motion.div>
);

const NoteCard = ({ note, index }: { note: HistoryNote; index: number }) => (
  <motion.div
    initial={{ opacity: 0, x: 20 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ delay: index * 0.04 }}
    className="glass-card p-6 space-y-3"
  >
    <div className="flex items-center justify-between">
      <p
        className={cn(
          "text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full",
          note.status === "final" ? "bg-success/10 text-success" : "bg-slate-700 text-white"
        )}
      >
        {note.status === "final" ? "Finalizada" : "Rascunho"}
      </p>
      <p className="text-xs text-slate-500">
        {new Date(note.created_at).toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })}
      </p>
    </div>
    <p className="text-sm text-slate-600">
      <strong>Queixa:</strong> {note.complaint || "-"}
    </p>
    <p className="text-sm text-slate-600">
      <strong>Intervencao:</strong> {note.intervention || "-"}
    </p>
    <p className="text-sm text-slate-600">
      <strong>Proximo foco:</strong> {note.next_focus || "-"}
    </p>
  </motion.div>
);

const FinancialCard = ({ record, index }: { record: FinancialRecord; index: number }) => (
  <motion.div
    initial={{ opacity: 0, x: 20 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ delay: index * 0.04 }}
    className="glass-card p-6 flex items-center justify-between"
  >
    <div>
      <p className="font-semibold text-slate-700">{record.description || "Lancamento financeiro"}</p>
      <p className="text-sm text-slate-500">
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
  </motion.div>
);
