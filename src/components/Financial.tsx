import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import {
  Plus,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Filter,
  Download,
  ArrowUpRight,
  ArrowDownRight,
  Edit,
  Trash2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { cn } from "../lib/utils";
import { ApiError, apiRequest } from "../lib/api";
import { formatLocalDateInput, formatLocalMonthInput, toLocalDateInput } from "../lib/date";
import { AiUsageSummary, FinancialRecord, Patient, UserRole } from "../lib/types";

interface FinancialProps {
  accessToken: string;
  role: UserRole;
}

type FinancialForm = {
  patient_id: string;
  amount: string;
  type: "income" | "expense";
  category: string;
  description: string;
  date: string;
  status: "paid" | "pending";
};

type BillingMode = "session" | "monthly";

type BillingSettings = {
  clinic_id: string;
  default_billing_mode: BillingMode;
  monthly_generation_day: number;
  timezone: string;
  auto_generate_monthly: boolean;
};

type PatientTerms = {
  patient_id: number;
  patient_name: string;
  session_fee: number;
  billing_mode_override: BillingMode | null;
  default_billing_mode: BillingMode;
  effective_billing_mode: BillingMode;
};

type MonthlySummary = {
  period: string;
  patient_id: number;
  patient_name: string;
  billing_mode: BillingMode;
  session_count: number;
  unit_price: number;
  gross_amount: number;
  paid_amount: number;
  outstanding_amount: number;
};

type Feedback = { type: "success" | "error"; message: string } | null;

const emptyFinancialForm: FinancialForm = {
  patient_id: "",
  amount: "",
  type: "income",
  category: "Sessao",
  description: "",
  date: formatLocalDateInput(),
  status: "paid",
};

function toDateInput(value: string | null | undefined) {
  return toLocalDateInput(value);
}

function currentMonthRef() {
  return formatLocalMonthInput();
}

export const Financial = ({ accessToken, role }: FinancialProps) => {
  const [records, setRecords] = useState<FinancialRecord[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState<number | null>(null);
  const [form, setForm] = useState<FinancialForm>(emptyFinancialForm);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filterType, setFilterType] = useState<"all" | "income" | "expense">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "paid" | "pending">("all");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [billingSettings, setBillingSettings] = useState<BillingSettings | null>(null);
  const [isSavingBillingSettings, setIsSavingBillingSettings] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState<string>("");
  const [patientTerms, setPatientTerms] = useState<PatientTerms | null>(null);
  const [isLoadingTerms, setIsLoadingTerms] = useState(false);
  const [isSavingTerms, setIsSavingTerms] = useState(false);
  const [termsSessionFee, setTermsSessionFee] = useState<string>("0");
  const [termsModeOverride, setTermsModeOverride] = useState<"default" | BillingMode>("default");
  const [monthlyRef, setMonthlyRef] = useState<string>(currentMonthRef());
  const [monthlySummary, setMonthlySummary] = useState<MonthlySummary | null>(null);
  const [isLoadingMonthlySummary, setIsLoadingMonthlySummary] = useState(false);
  const [isGeneratingMonthly, setIsGeneratingMonthly] = useState(false);
  const [aiUsageMonth, setAiUsageMonth] = useState<string>(currentMonthRef());
  const [aiUsageSummary, setAiUsageSummary] = useState<AiUsageSummary | null>(null);
  const [isLoadingAiUsage, setIsLoadingAiUsage] = useState(false);
  const canManageFinancial = role === "admin" || role === "professional";

  useEffect(() => {
    fetchFinancial();
    fetchPatients();
    if (canManageFinancial) {
      fetchBillingSettings();
    }
  }, [accessToken, canManageFinancial]);

  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(() => setFeedback(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  useEffect(() => {
    if (!selectedPatientId && patients.length > 0) {
      setSelectedPatientId(String(patients[0].id));
    }
  }, [patients, selectedPatientId]);

  useEffect(() => {
    if (!canManageFinancial) return;
    if (!selectedPatientId) {
      setPatientTerms(null);
      setMonthlySummary(null);
      return;
    }
    fetchPatientTerms(Number(selectedPatientId));
    fetchMonthlySummary(Number(selectedPatientId), monthlyRef);
  }, [selectedPatientId, monthlyRef, accessToken, canManageFinancial]);

  useEffect(() => {
    if (!canManageFinancial) return;
    fetchAiUsageSummary(aiUsageMonth);
  }, [aiUsageMonth, accessToken, canManageFinancial]);

  const fetchFinancial = async () => {
    setIsLoading(true);
    try {
      const data = await apiRequest<FinancialRecord[]>("/api/financial", accessToken);
      setRecords(data || []);
    } catch (error: unknown) {
      console.error("Failed to load financial records", error);
      setFeedback({
        type: "error",
        message: error instanceof ApiError ? error.message : "Falha ao carregar lancamentos.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPatients = async () => {
    try {
      const data = await apiRequest<Patient[]>("/api/patients", accessToken);
      setPatients(data || []);
    } catch (error: unknown) {
      console.error("Failed to load patients", error);
      setFeedback({
        type: "error",
        message: error instanceof ApiError ? error.message : "Falha ao carregar pacientes.",
      });
    }
  };

  const fetchBillingSettings = async () => {
    try {
      const data = await apiRequest<BillingSettings>("/api/financial/billing/settings", accessToken);
      setBillingSettings(data);
    } catch (error) {
      console.error("Failed to load billing settings", error);
    }
  };

  const saveBillingSettings = async () => {
    if (!canManageFinancial) return;
    if (!billingSettings) return;
    setIsSavingBillingSettings(true);
    try {
      await apiRequest<BillingSettings>("/api/financial/billing/settings", accessToken, {
        method: "PATCH",
        body: JSON.stringify({
          default_billing_mode: billingSettings.default_billing_mode,
          monthly_generation_day: billingSettings.monthly_generation_day,
          timezone: billingSettings.timezone,
          auto_generate_monthly: billingSettings.auto_generate_monthly,
        }),
      });
      await fetchBillingSettings();
      setFeedback({ type: "success", message: "Padroes financeiros da clinica atualizados." });
    } catch (error: unknown) {
      console.error("Failed to save billing settings", error);
      setFeedback({
        type: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "Falha ao salvar padroes financeiros da clinica.",
      });
    } finally {
      setIsSavingBillingSettings(false);
    }
  };

  const fetchPatientTerms = async (patientId: number) => {
    setIsLoadingTerms(true);
    try {
      const data = await apiRequest<PatientTerms>(
        `/api/financial/patient/${patientId}/terms`,
        accessToken
      );
      setPatientTerms(data);
      setTermsSessionFee(String(Number(data.session_fee || 0)));
      setTermsModeOverride(data.billing_mode_override || "default");
    } catch (error) {
      console.error("Failed to load patient terms", error);
      setPatientTerms(null);
    } finally {
      setIsLoadingTerms(false);
    }
  };

  const savePatientTerms = async () => {
    if (!canManageFinancial) return;
    if (!selectedPatientId) return;
    setIsSavingTerms(true);
    try {
      const patientId = Number(selectedPatientId);
      await apiRequest<PatientTerms>(`/api/financial/patient/${patientId}/terms`, accessToken, {
        method: "PATCH",
        body: JSON.stringify({
          session_fee: Number(termsSessionFee || 0),
          billing_mode_override: termsModeOverride === "default" ? null : termsModeOverride,
        }),
      });
      await Promise.all([
        fetchPatientTerms(patientId),
        fetchMonthlySummary(patientId, monthlyRef),
      ]);
      setFeedback({ type: "success", message: "Termos financeiros do paciente atualizados." });
    } catch (error) {
      console.error("Failed to save patient terms", error);
      setFeedback({ type: "error", message: "Falha ao salvar termos financeiros do paciente." });
    } finally {
      setIsSavingTerms(false);
    }
  };

  const fetchMonthlySummary = async (patientId: number, month: string) => {
    setIsLoadingMonthlySummary(true);
    try {
      const data = await apiRequest<MonthlySummary>(
        `/api/financial/patient/${patientId}/monthly-summary?month=${month}`,
        accessToken
      );
      setMonthlySummary(data);
    } catch (error) {
      console.error("Failed to load monthly summary", error);
      setMonthlySummary(null);
    } finally {
      setIsLoadingMonthlySummary(false);
    }
  };

  const generateMonthly = async () => {
    if (!canManageFinancial) return;
    if (!selectedPatientId) return;
    setIsGeneratingMonthly(true);
    try {
      const patientId = Number(selectedPatientId);
      await apiRequest<{ generated_count: number }>(
        `/api/financial/monthly/generate?month=${monthlyRef}`,
        accessToken,
        {
        method: "POST",
        body: JSON.stringify({ patient_id: patientId }),
        }
      );
      await fetchMonthlySummary(patientId, monthlyRef);
      setFeedback({ type: "success", message: "Fechamento mensal gerado para o paciente." });
    } catch (error) {
      console.error("Failed to generate monthly billing", error);
      setFeedback({ type: "error", message: "Falha ao gerar fechamento mensal." });
    } finally {
      setIsGeneratingMonthly(false);
    }
  };

  const fetchAiUsageSummary = async (month: string) => {
    setIsLoadingAiUsage(true);
    try {
      const data = await apiRequest<AiUsageSummary>(
        `/api/ai/usage/summary?month=${month}`,
        accessToken
      );
      setAiUsageSummary(data);
    } catch (error: unknown) {
      console.error("Failed to load AI usage summary", error);
      setAiUsageSummary(null);
      setFeedback({
        type: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "Falha ao carregar medidor de uso da IA.",
      });
    } finally {
      setIsLoadingAiUsage(false);
    }
  };

  const openCreateModal = () => {
    if (!canManageFinancial) return;
    setEditingRecordId(null);
    setForm({ ...emptyFinancialForm, date: formatLocalDateInput() });
    setIsModalOpen(true);
  };

  const openEditModal = (record: FinancialRecord) => {
    if (!canManageFinancial) return;
    setEditingRecordId(Number(record.id));
    setForm({
      patient_id: record.patient_id ? String(record.patient_id) : "",
      amount: String(record.amount ?? ""),
      type: record.type === "expense" ? "expense" : "income",
      category: record.category || "Sessao",
      description: record.description || "",
      date: toDateInput(record.date),
      status: record.status === "pending" ? "pending" : "paid",
    });
    setIsModalOpen(true);
  };

  const handleSaveRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageFinancial) return;
    const amountNumber = Number(form.amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setFeedback({ type: "error", message: "Informe um valor maior que zero." });
      return;
    }
    if (!form.description.trim()) {
      setFeedback({ type: "error", message: "Descricao e obrigatoria." });
      return;
    }

    setIsSaving(true);
    try {
      if (editingRecordId === null) {
        await apiRequest<{ id: number }>("/api/financial", accessToken, {
          method: "POST",
          body: JSON.stringify(form),
        });
        setFeedback({ type: "success", message: "Lancamento criado com sucesso." });
      } else {
        await apiRequest<{ id: number }>(`/api/financial/${editingRecordId}`, accessToken, {
          method: "PUT",
          body: JSON.stringify(form),
        });
        setFeedback({ type: "success", message: "Lancamento atualizado com sucesso." });
      }
      await fetchFinancial();
      setIsModalOpen(false);
      setEditingRecordId(null);
      setForm(emptyFinancialForm);
    } catch (error) {
      console.error("Failed to save financial record", error);
      setFeedback({ type: "error", message: "Falha ao salvar lancamento." });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteRecord = async (recordId: number) => {
    if (!canManageFinancial) return;
    const confirmed = window.confirm("Excluir este lancamento financeiro?");
    if (!confirmed) return;

    setDeletingId(recordId);
    try {
      await apiRequest<{ success: boolean }>(`/api/financial/${recordId}`, accessToken, {
        method: "DELETE",
      });
      await fetchFinancial();
      setFeedback({ type: "success", message: "Lancamento excluido com sucesso." });
      if (editingRecordId === recordId) {
        setIsModalOpen(false);
        setEditingRecordId(null);
        setForm(emptyFinancialForm);
      }
    } catch (error) {
      console.error("Failed to delete financial record", error);
      setFeedback({ type: "error", message: "Falha ao excluir lancamento." });
    } finally {
      setDeletingId(null);
    }
  };

  const totalIncome = records
    .filter((r) => r.type === "income")
    .reduce((acc, r) => acc + Number(r.amount || 0), 0);
  const totalExpense = records
    .filter((r) => r.type === "expense")
    .reduce((acc, r) => acc + Number(r.amount || 0), 0);
  const balance = totalIncome - totalExpense;
  const filteredRecords = records.filter((record) => {
    const matchesType = filterType === "all" ? true : record.type === filterType;
    const matchesStatus = filterStatus === "all" ? true : record.status === filterStatus;
    return matchesType && matchesStatus;
  });

  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      const header = ["id", "date", "description", "category", "type", "status", "amount", "patient_name"];
      const rows = records.map((r) => [
        r.id,
        new Date(r.date).toISOString(),
        `"${String(r.description || "").replace(/"/g, '""')}"`,
        `"${String(r.category || "").replace(/"/g, '""')}"`,
        r.type,
        r.status,
        Number(r.amount || 0).toFixed(2),
        `"${String(r.patient_name || "").replace(/"/g, '""')}"`,
      ]);
      const csv = [header.join(","), ...rows.map((row) => row.join(","))].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `financeiro-${formatLocalDateInput()}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setFeedback({ type: "success", message: "Relatorio exportado em CSV." });
    } catch (error) {
      console.error("Failed to export financial report", error);
      setFeedback({ type: "error", message: "Falha ao exportar relatorio." });
    } finally {
      setIsExporting(false);
    }
  };

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

      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Financeiro</h2>
          <p className="text-slate-500">Controle receitas e despesas da clinica.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleExportCsv}
            disabled={isExporting}
            className="bg-white/50 backdrop-blur-sm border border-black/5 px-6 py-3 rounded-2xl font-semibold text-slate-600 flex items-center gap-2 hover:bg-white/80 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Download size={20} />
            {isExporting ? "Exportando..." : "Relatorios"}
          </button>
          {canManageFinancial && (
            <button
              onClick={openCreateModal}
              className="bg-petroleum text-white px-6 py-3 rounded-2xl font-semibold shadow-lg shadow-petroleum/20 flex items-center gap-2 hover:scale-105 active:scale-95 transition-all"
            >
              <Plus size={20} />
              Novo Lancamento
            </button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-panel p-8 bg-white/40">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-success/10 rounded-2xl flex items-center justify-center text-success">
              <TrendingUp size={24} />
            </div>
            <span className="text-xs font-bold text-success bg-success/10 px-2 py-1 rounded-lg">
              +12%
            </span>
          </div>
          <p className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-1">
            Receita Mensal
          </p>
          <h3 className="text-3xl font-bold text-petroleum">
            R$ {totalIncome.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
          </h3>
        </div>

        <div className="glass-panel p-8 bg-white/40">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-error/10 rounded-2xl flex items-center justify-center text-error">
              <TrendingDown size={24} />
            </div>
            <span className="text-xs font-bold text-error bg-error/10 px-2 py-1 rounded-lg">
              -5%
            </span>
          </div>
          <p className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-1">
            Despesas Mensais
          </p>
          <h3 className="text-3xl font-bold text-petroleum">
            R$ {totalExpense.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
          </h3>
        </div>

        <div className="glass-panel p-8 bg-petroleum text-white">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center">
              <DollarSign size={24} />
            </div>
          </div>
          <p className="text-sm font-bold text-white/50 uppercase tracking-wider mb-1">
            Saldo Liquido
          </p>
          <h3 className="text-3xl font-bold">
            R$ {balance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
          </h3>
        </div>
      </div>

      {canManageFinancial ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="glass-panel p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800">Padrao financeiro da clinica</h3>
            {!billingSettings ? (
              <p className="text-sm text-slate-500">Carregando configuracoes...</p>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      Modo padrao
                    </label>
                    <select
                      value={billingSettings.default_billing_mode}
                      onChange={(e) =>
                        setBillingSettings((prev) =>
                          prev
                            ? {
                                ...prev,
                                default_billing_mode:
                                  e.target.value === "monthly" ? "monthly" : "session",
                              }
                            : prev
                        )
                      }
                      className="apple-input w-full appearance-none"
                    >
                      <option value="session">Por sessao</option>
                      <option value="monthly">Mensal consolidado</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      Dia de geracao mensal
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={28}
                      value={billingSettings.monthly_generation_day}
                      onChange={(e) =>
                        setBillingSettings((prev) =>
                          prev
                            ? {
                                ...prev,
                                monthly_generation_day: Math.min(
                                  28,
                                  Math.max(1, Number(e.target.value || 1))
                                ),
                              }
                            : prev
                        )
                      }
                      className="apple-input w-full"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      Timezone
                    </label>
                    <input
                      type="text"
                      value={billingSettings.timezone}
                      onChange={(e) =>
                        setBillingSettings((prev) =>
                          prev ? { ...prev, timezone: e.target.value } : prev
                        )
                      }
                      className="apple-input w-full"
                    />
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm text-slate-600 mt-6">
                    <input
                      type="checkbox"
                      checked={billingSettings.auto_generate_monthly}
                      onChange={(e) =>
                        setBillingSettings((prev) =>
                          prev ? { ...prev, auto_generate_monthly: e.target.checked } : prev
                        )
                      }
                    />
                    Geracao mensal automatica
                  </label>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={saveBillingSettings}
                    disabled={isSavingBillingSettings}
                    className="bg-petroleum text-white px-5 py-2.5 rounded-xl font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isSavingBillingSettings ? "Salvando..." : "Salvar padrao"}
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="glass-panel p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800">Devido mensal por paciente</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Paciente
                </label>
                <select
                  value={selectedPatientId}
                  onChange={(e) => setSelectedPatientId(e.target.value)}
                  className="apple-input w-full appearance-none"
                >
                  <option value="">Selecione</option>
                  {patients.map((patient) => (
                    <option key={patient.id} value={patient.id}>
                      {patient.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Competencia
                </label>
                <input
                  type="month"
                  value={monthlyRef}
                  onChange={(e) => setMonthlyRef(e.target.value)}
                  className="apple-input w-full"
                />
              </div>
            </div>

            {selectedPatientId && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Valor sessao (R$)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={termsSessionFee}
                    onChange={(e) => setTermsSessionFee(e.target.value)}
                    className="apple-input w-full"
                    disabled={isLoadingTerms}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Modo cobranca
                  </label>
                  <select
                    value={termsModeOverride}
                    onChange={(e) =>
                      setTermsModeOverride(
                        e.target.value === "monthly"
                          ? "monthly"
                          : e.target.value === "session"
                          ? "session"
                          : "default"
                      )
                    }
                    className="apple-input w-full appearance-none"
                    disabled={isLoadingTerms}
                  >
                    <option value="default">Padrao da clinica</option>
                    <option value="session">Por sessao</option>
                    <option value="monthly">Mensal consolidado</option>
                  </select>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={savePatientTerms}
                disabled={!selectedPatientId || isSavingTerms || isLoadingTerms}
                className="bg-white border border-black/10 text-slate-700 px-4 py-2.5 rounded-xl font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSavingTerms ? "Salvando..." : "Salvar termos do paciente"}
              </button>
              <button
                type="button"
                onClick={generateMonthly}
                disabled={!selectedPatientId || isGeneratingMonthly}
                className="bg-petroleum text-white px-4 py-2.5 rounded-xl font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isGeneratingMonthly ? "Gerando..." : "Gerar fechamento mensal"}
              </button>
            </div>

            {isLoadingMonthlySummary ? (
              <p className="text-sm text-slate-500">Calculando resumo mensal...</p>
            ) : monthlySummary ? (
              <div className="rounded-xl border border-black/10 p-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-slate-400 uppercase text-[10px] font-bold tracking-widest">
                    Sessoes no mes
                  </p>
                  <p className="font-bold text-slate-700">{monthlySummary.session_count}</p>
                </div>
                <div>
                  <p className="text-slate-400 uppercase text-[10px] font-bold tracking-widest">
                    Modo efetivo
                  </p>
                  <p className="font-bold text-slate-700">{monthlySummary.billing_mode}</p>
                </div>
                <div>
                  <p className="text-slate-400 uppercase text-[10px] font-bold tracking-widest">
                    Valor bruto
                  </p>
                  <p className="font-bold text-slate-700">
                    R${" "}
                    {Number(monthlySummary.gross_amount || 0).toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                    })}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 uppercase text-[10px] font-bold tracking-widest">
                    Pago no mes
                  </p>
                  <p className="font-bold text-success">
                    R$ {Number(monthlySummary.paid_amount || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="text-slate-400 uppercase text-[10px] font-bold tracking-widest">
                    Em aberto
                  </p>
                  <p className="font-bold text-error text-lg">
                    R$ {Number(monthlySummary.outstanding_amount || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                Selecione um paciente para ver o valor devido no mes.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="glass-panel p-6 border border-warning/20 bg-warning/10 text-warning">
          Perfil de secretaria: configuracoes financeiras avancadas e ajustes de cobranca estao
          ocultos.
        </div>
      )}

      {canManageFinancial && (
        <div className="glass-panel p-6 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-slate-800">Medidor de uso da IA</h3>
              <p className="text-sm text-slate-500">
                Consumo estimado de transcricoes por competencia.
              </p>
            </div>
            <input
              type="month"
              value={aiUsageMonth}
              onChange={(e) => setAiUsageMonth(e.target.value)}
              className="apple-input w-full md:w-[220px]"
            />
          </div>

          {isLoadingAiUsage ? (
            <p className="text-sm text-slate-500">Carregando uso de IA...</p>
          ) : aiUsageSummary ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="rounded-xl border border-black/10 p-4 bg-white/50">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Requisicoes IA
                  </p>
                  <p className="text-2xl font-bold text-petroleum">{aiUsageSummary.totals.requests}</p>
                  <p className="text-xs text-slate-500">
                    {aiUsageSummary.totals.success_count} sucesso / {aiUsageSummary.totals.failed_count} falha
                  </p>
                </div>
                <div className="rounded-xl border border-black/10 p-4 bg-white/50">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Audio processado
                  </p>
                  <p className="text-2xl font-bold text-petroleum">
                    {Number(aiUsageSummary.totals.input_minutes || 0).toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                    })}{" "}
                    min
                  </p>
                  <p className="text-xs text-slate-500">
                    {Math.round(Number(aiUsageSummary.totals.input_audio_bytes || 0) / 1024)} KB
                  </p>
                </div>
                <div className="rounded-xl border border-black/10 p-4 bg-white/50">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Tokens estimados
                  </p>
                  <p className="text-2xl font-bold text-petroleum">
                    {Number(aiUsageSummary.totals.total_tokens_estimated || 0).toLocaleString("pt-BR")}
                  </p>
                  <p className="text-xs text-slate-500">
                    Entrada {Number(aiUsageSummary.totals.input_tokens_estimated || 0).toLocaleString("pt-BR")} /
                    Saida {Number(aiUsageSummary.totals.output_tokens_estimated || 0).toLocaleString("pt-BR")}
                  </p>
                </div>
                <div className="rounded-xl border border-black/10 p-4 bg-petroleum text-white">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">
                    Custo estimado
                  </p>
                  <p className="text-2xl font-bold">
                    {aiUsageSummary.pricing.currency}{" "}
                    {Number(aiUsageSummary.totals.estimated_cost || 0).toLocaleString("pt-BR", {
                      minimumFractionDigits: 4,
                      maximumFractionDigits: 6,
                    })}
                  </p>
                  <p className="text-xs text-white/70">
                    {aiUsageSummary.period} • modelo principal {aiUsageSummary.by_model[0]?.model || "-"}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-black/10 p-4 bg-white/50">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                    Distribuicao por modelo
                  </p>
                  {aiUsageSummary.by_model.length === 0 ? (
                    <p className="text-sm text-slate-500">Sem uso de IA nesta competencia.</p>
                  ) : (
                    <div className="space-y-2">
                      {aiUsageSummary.by_model.slice(0, 5).map((item) => (
                        <div
                          key={item.model}
                          className="flex items-center justify-between text-sm border-b border-black/5 pb-2 last:border-0 last:pb-0"
                        >
                          <div>
                            <p className="font-semibold text-slate-700">{item.model}</p>
                            <p className="text-xs text-slate-500">
                              {item.requests} req • {item.success_count} ok / {item.failed_count} falha
                            </p>
                          </div>
                          <p className="font-bold text-slate-700">
                            {Number(item.total_tokens_estimated || 0).toLocaleString("pt-BR")}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-black/10 p-4 bg-white/50">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                    Ultimos eventos
                  </p>
                  {aiUsageSummary.recent.length === 0 ? (
                    <p className="text-sm text-slate-500">Sem eventos recentes.</p>
                  ) : (
                    <div className="space-y-2">
                      {aiUsageSummary.recent.slice(0, 5).map((item) => (
                        <div
                          key={`${item.id ?? "event"}-${item.created_at ?? ""}`}
                          className="flex items-center justify-between text-sm border-b border-black/5 pb-2 last:border-0 last:pb-0"
                        >
                          <div>
                            <p className="font-semibold text-slate-700">{item.model}</p>
                            <p className="text-xs text-slate-500">
                              {(item.created_at || "").replace("T", " ").slice(0, 16)} • {item.status}
                            </p>
                          </div>
                          <p className="font-bold text-slate-700">
                            {Number(item.total_tokens_estimated || 0).toLocaleString("pt-BR")}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">Sem dados de uso de IA para a competencia selecionada.</p>
          )}
        </div>
      )}

      <div className="glass-panel overflow-hidden">
        <div className="px-8 py-6 border-b border-black/5 flex items-center justify-between bg-white/40">
          <h3 className="text-xl font-bold">Ultimas Transacoes</h3>
          <div className="flex gap-2">
            <button
              onClick={() => setShowFilters((prev) => !prev)}
              className={cn(
                "p-2 rounded-xl transition-all",
                showFilters ? "bg-petroleum/10 text-petroleum" : "hover:bg-white/60"
              )}
              title="Filtrar"
            >
              <Filter size={20} />
            </button>
          </div>
        </div>
        {showFilters && (
          <div className="px-8 py-4 border-b border-black/5 bg-slate-50/50 flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Tipo
              </label>
              <select
                value={filterType}
                onChange={(e) =>
                  setFilterType(e.target.value as "all" | "income" | "expense")
                }
                className="apple-input min-w-[180px] appearance-none"
              >
                <option value="all">Todos</option>
                <option value="income">Receitas</option>
                <option value="expense">Despesas</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Status
              </label>
              <select
                value={filterStatus}
                onChange={(e) =>
                  setFilterStatus(e.target.value as "all" | "paid" | "pending")
                }
                className="apple-input min-w-[180px] appearance-none"
              >
                <option value="all">Todos</option>
                <option value="paid">Pago</option>
                <option value="pending">Pendente</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() => {
                setFilterType("all");
                setFilterStatus("all");
              }}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-500 hover:bg-white transition-all"
            >
              Limpar filtros
            </button>
          </div>
        )}
        {isLoading ? (
          <div className="p-10 text-center text-slate-500">Carregando lancamentos...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
	                <tr className="text-xs font-bold text-slate-400 uppercase tracking-widest bg-slate-50/50">
	                  <th className="px-8 py-4">Data</th>
	                  <th className="px-8 py-4">Descricao</th>
	                  <th className="px-8 py-4">Categoria</th>
	                  <th className="px-8 py-4">Valor</th>
	                  <th className="px-8 py-4">Status</th>
	                  {canManageFinancial && <th className="px-8 py-4 text-right">Acoes</th>}
	                </tr>
	              </thead>
	              <tbody className="divide-y divide-black/5">
	                {filteredRecords.map((record) => (
                  <tr key={record.id} className="hover:bg-white/20 transition-colors group">
                    <td className="px-8 py-5 text-sm font-medium text-slate-500">
                      {new Date(record.date).toLocaleDateString()}
                    </td>
                    <td className="px-8 py-5">
                      <p className="font-bold text-slate-700">
                        {record.description || record.patient_name || "Lancamento Avulso"}
                      </p>
                    </td>
                    <td className="px-8 py-5">
                      <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-lg uppercase tracking-wider">
                        {record.category || "-"}
                      </span>
                    </td>
                    <td className="px-8 py-5">
                      <div
                        className={cn(
                          "flex items-center gap-1 font-bold",
                          record.type === "income" ? "text-success" : "text-error"
                        )}
                      >
                        {record.type === "income" ? (
                          <ArrowUpRight size={16} />
                        ) : (
                          <ArrowDownRight size={16} />
                        )}
                        R${" "}
                        {Number(record.amount || 0).toLocaleString("pt-BR", {
                          minimumFractionDigits: 2,
                        })}
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <span
                        className={cn(
                          "text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-widest",
                          record.status === "paid"
                            ? "bg-success/10 text-success"
                            : "bg-warning/10 text-warning"
                        )}
                      >
                        {record.status === "paid" ? "Pago" : "Pendente"}
                      </span>
                    </td>
	                    {canManageFinancial && (
	                      <td className="px-8 py-5 text-right">
	                        <div className="flex items-center justify-end gap-2">
	                          <button
	                            onClick={() => openEditModal(record)}
	                            className="p-2 text-slate-500 hover:text-petroleum hover:bg-petroleum/10 rounded-lg transition-all"
	                            title="Editar"
	                          >
	                            <Edit size={16} />
	                          </button>
	                          <button
	                            onClick={() => handleDeleteRecord(Number(record.id))}
	                            disabled={deletingId === Number(record.id)}
	                            className="p-2 text-slate-500 hover:text-error hover:bg-error/10 rounded-lg transition-all disabled:opacity-50"
	                            title="Excluir"
	                          >
	                            <Trash2 size={16} />
	                          </button>
	                        </div>
	                      </td>
	                    )}
	                  </tr>
	                ))}
	                {filteredRecords.length === 0 && (
	                  <tr>
	                    <td
	                      colSpan={canManageFinancial ? 6 : 5}
	                      className="px-8 py-10 text-center text-slate-500"
	                    >
	                      Nenhum lancamento encontrado para o filtro selecionado.
	                    </td>
	                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canManageFinancial && isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-panel w-full max-w-md p-8"
          >
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-2xl font-bold">
                {editingRecordId === null ? "Novo Lancamento" : "Editar Lancamento"}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <Plus size={24} className="rotate-45" />
              </button>
            </div>

            <form onSubmit={handleSaveRecord} className="space-y-6">
              <div className="flex p-1 bg-slate-100 rounded-xl mb-6">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, type: "income" })}
                  className={cn(
                    "flex-1 py-2 rounded-lg text-sm font-bold transition-all",
                    form.type === "income" ? "bg-white text-success shadow-sm" : "text-slate-500"
                  )}
                >
                  Receita
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, type: "expense" })}
                  className={cn(
                    "flex-1 py-2 rounded-lg text-sm font-bold transition-all",
                    form.type === "expense" ? "bg-white text-error shadow-sm" : "text-slate-500"
                  )}
                >
                  Despesa
                </button>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Paciente (opcional)
                </label>
                <select
                  value={form.patient_id}
                  onChange={(e) => setForm({ ...form, patient_id: e.target.value })}
                  className="apple-input w-full appearance-none"
                >
                  <option value="">Lancamento sem paciente</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Valor (R$)
                </label>
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className="apple-input w-full text-2xl font-bold text-petroleum"
                  placeholder="0,00"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Descricao
                </label>
                <input
                  required
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="apple-input w-full"
                  placeholder="Ex: aluguel, sessao avulsa..."
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Categoria
                </label>
                <input
                  type="text"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="apple-input w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Data
                  </label>
                  <input
                    required
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="apple-input w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Status
                  </label>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm({ ...form, status: e.target.value as "paid" | "pending" })
                    }
                    className="apple-input w-full appearance-none"
                  >
                    <option value="paid">Pago</option>
                    <option value="pending">Pendente</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-4 pt-4">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-6 py-3 rounded-xl font-semibold text-slate-500 hover:bg-slate-100 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="bg-petroleum text-white px-8 py-3 rounded-xl font-semibold shadow-lg shadow-petroleum/20 hover:scale-105 active:scale-95 transition-all disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  {isSaving
                    ? "Salvando..."
                    : editingRecordId === null
                    ? "Lancar"
                    : "Salvar Alteracoes"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};
