import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  Plus,
  Search,
  User,
  Mail,
  Phone,
  Calendar,
  ChevronRight,
  Trash2,
  Edit,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { ApiError, apiRequest } from "../lib/api";
import { toOptionalLocalDateInput } from "../lib/date";
import { Patient, UserRole } from "../lib/types";

interface PatientsProps {
  accessToken: string;
  role: UserRole;
  onSelectPatient: (patient: Patient) => void;
}

type PatientForm = {
  name: string;
  email: string;
  phone: string;
  birth_date: string;
  cpf: string;
  address: string;
  notes: string;
  session_fee: string;
  billing_mode_override: "default" | "session" | "monthly";
};

type Feedback = { type: "success" | "error"; message: string } | null;

const emptyPatientForm: PatientForm = {
  name: "",
  email: "",
  phone: "",
  birth_date: "",
  cpf: "",
  address: "",
  notes: "",
  session_fee: "0",
  billing_mode_override: "default",
};

export const Patients = ({ accessToken, role, onSelectPatient }: PatientsProps) => {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [search, setSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPatientId, setEditingPatientId] = useState<number | null>(null);
  const [form, setForm] = useState<PatientForm>(emptyPatientForm);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    fetchPatients();
  }, [accessToken]);

  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(() => setFeedback(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  const fetchPatients = async () => {
    setIsLoading(true);
    try {
      const data = await apiRequest<Patient[]>("/api/patients", accessToken);
      setPatients(data || []);
    } catch (error: unknown) {
      console.error("Failed to load patients", error);
      setFeedback({
        type: "error",
        message: error instanceof ApiError ? error.message : "Falha ao carregar pacientes.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const openCreateModal = () => {
    setEditingPatientId(null);
    setForm(emptyPatientForm);
    setIsModalOpen(true);
  };

  const openEditModal = (patient: Patient) => {
    setEditingPatientId(Number(patient.id));
    setForm({
      name: patient.name || "",
      email: patient.email || "",
      phone: patient.phone || "",
      birth_date: toOptionalLocalDateInput(patient.birth_date),
      cpf: patient.cpf || "",
      address: patient.address || "",
      notes: patient.notes || "",
      session_fee: String(Number(patient.session_fee || 0)),
      billing_mode_override:
        patient.billing_mode_override === "session" || patient.billing_mode_override === "monthly"
          ? patient.billing_mode_override
          : "default",
    });
    setIsModalOpen(true);
  };

  const handleSavePatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setFeedback({ type: "error", message: "Nome do paciente e obrigatorio." });
      return;
    }

    setIsSaving(true);
    try {
      const payload: {
        name: string;
        email: string;
        phone: string;
        birth_date: string;
        cpf: string;
        address: string;
        session_fee: number;
        billing_mode_override: "session" | "monthly" | null;
        notes?: string;
      } = {
        ...form,
        session_fee: Number(form.session_fee || 0),
        billing_mode_override:
          form.billing_mode_override === "default" ? null : form.billing_mode_override,
      };
      if (role !== "secretary") {
        payload.notes = form.notes;
      } else {
        delete payload.notes;
      }
      if (editingPatientId === null) {
        await apiRequest<{ id: number }>("/api/patients", accessToken, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setFeedback({ type: "success", message: "Paciente criado com sucesso." });
      } else {
        await apiRequest<{ id: number }>(`/api/patients/${editingPatientId}`, accessToken, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        setFeedback({ type: "success", message: "Paciente atualizado com sucesso." });
      }

      await fetchPatients();
      setIsModalOpen(false);
      setEditingPatientId(null);
      setForm(emptyPatientForm);
    } catch (error: unknown) {
      console.error("Failed to save patient", error);
      const errorMessage = error instanceof ApiError ? error.message : "";
      setFeedback({
        type: "error",
        message: errorMessage.includes("Request failed")
          ? "Nao foi possivel salvar o paciente."
          : "Erro ao salvar paciente.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeletePatient = async (patientId: number) => {
    const confirmed = window.confirm(
      "Excluir este paciente? Isso remove agendamentos vinculados e nao pode ser desfeito."
    );
    if (!confirmed) return;

    setDeletingId(patientId);
    try {
      await apiRequest<{ success: boolean }>(`/api/patients/${patientId}`, accessToken, {
        method: "DELETE",
      });
      await fetchPatients();
      setFeedback({ type: "success", message: "Paciente excluido com sucesso." });
      if (editingPatientId === patientId) {
        setIsModalOpen(false);
        setEditingPatientId(null);
        setForm(emptyPatientForm);
      }
    } catch (error) {
      console.error("Failed to delete patient", error);
      setFeedback({ type: "error", message: "Falha ao excluir paciente." });
    } finally {
      setDeletingId(null);
    }
  };

  const filteredPatients = patients.filter((p) => {
    const name = String(p.name || "").toLowerCase();
    const email = String(p.email || "").toLowerCase();
    const q = search.toLowerCase();
    return name.includes(q) || email.includes(q);
  });

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
          <h2 className="text-3xl font-bold tracking-tight">Pacientes</h2>
          <p className="text-slate-500">Gerencie cadastro e historico dos pacientes.</p>
        </div>
        <button
          onClick={openCreateModal}
          className="bg-petroleum text-white px-6 py-3 rounded-2xl font-semibold shadow-lg shadow-petroleum/20 flex items-center gap-2 hover:scale-105 active:scale-95 transition-all"
        >
          <Plus size={20} />
          Novo Paciente
        </button>
      </header>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input
            type="text"
            placeholder="Buscar por nome ou e-mail..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="apple-input w-full pl-12"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="glass-panel p-12 text-center text-slate-500">Carregando pacientes...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPatients.map((patient) => (
            <motion.div
              key={patient.id}
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={() => onSelectPatient(patient)}
              className="glass-card p-6 group relative cursor-pointer"
            >
              <div className="flex justify-between items-start mb-6">
                <div className="w-14 h-14 bg-petroleum/10 rounded-2xl flex items-center justify-center text-petroleum">
                  <User size={28} />
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditModal(patient);
                    }}
                    className="p-2 text-slate-400 hover:text-petroleum hover:bg-petroleum/10 rounded-lg transition-all"
                    title="Editar"
                  >
                    <Edit size={16} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeletePatient(Number(patient.id));
                    }}
                    disabled={deletingId === Number(patient.id)}
                    className="p-2 text-slate-400 hover:text-error hover:bg-error/10 rounded-lg transition-all disabled:opacity-50"
                    title="Excluir"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <h3 className="font-bold text-xl mb-4 group-hover:text-petroleum transition-colors">
                {patient.name}
              </h3>

              <div className="space-y-3 text-sm text-slate-500">
                <div className="flex items-center gap-2">
                  <Mail size={14} className="text-slate-400" />
                  {patient.email || "Sem e-mail"}
                </div>
                <div className="flex items-center gap-2">
                  <Phone size={14} className="text-slate-400" />
                  {patient.phone || "Sem telefone"}
                </div>
                <div className="flex items-center gap-2">
                  <Calendar size={14} className="text-slate-400" />
                  {patient.birth_date ? new Date(patient.birth_date).toLocaleDateString() : "Sem data"}
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-black/5 flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-bold text-petroleum uppercase tracking-wider">
                    {patient.session_count || 0} Sessoes
                  </p>
                  <p className="text-xs text-slate-500">
                    R$ {Number(patient.session_fee || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    {" · "}
                    {(patient.billing_mode_override || "padrao clinica") as string}
                  </p>
                </div>
                <ChevronRight size={18} className="text-slate-300" />
              </div>
            </motion.div>
          ))}
          {filteredPatients.length === 0 && (
            <div className="col-span-full glass-panel p-12 text-center text-slate-500">
              Nenhum paciente encontrado.
            </div>
          )}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-panel w-full max-w-2xl p-8 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-2xl font-bold">
                {editingPatientId === null ? "Cadastrar Novo Paciente" : "Editar Paciente"}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <Plus size={24} className="rotate-45" />
              </button>
            </div>

            <form onSubmit={handleSavePatient} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Nome Completo
                  </label>
                  <input
                    required
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="apple-input w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    E-mail
                  </label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="apple-input w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Telefone
                  </label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="apple-input w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Data de Nascimento
                  </label>
                  <input
                    type="date"
                    value={form.birth_date}
                    onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
                    className="apple-input w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    CPF
                  </label>
                  <input
                    type="text"
                    value={form.cpf}
                    onChange={(e) => setForm({ ...form, cpf: e.target.value })}
                    className="apple-input w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Endereco
                  </label>
                  <input
                    type="text"
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    className="apple-input w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Valor por sessao (R$)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.session_fee}
                    onChange={(e) => setForm({ ...form, session_fee: e.target.value })}
                    className="apple-input w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Modo de cobranca
                  </label>
                  <select
                    value={form.billing_mode_override}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        billing_mode_override:
                          e.target.value === "session" || e.target.value === "monthly"
                            ? e.target.value
                            : "default",
                      })
                    }
                    className="apple-input w-full appearance-none"
                  >
                    <option value="default">Padrao da clinica</option>
                    <option value="session">Por sessao</option>
                    <option value="monthly">Mensal consolidado</option>
                  </select>
                </div>
              </div>

              {role !== "secretary" && (
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Observacoes Iniciais
                  </label>
                  <textarea
                    rows={3}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className="apple-input w-full resize-none"
                  />
                </div>
              )}

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
                    : editingPatientId === null
                    ? "Cadastrar"
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
