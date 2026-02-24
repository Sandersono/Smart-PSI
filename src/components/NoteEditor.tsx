import React from "react";
import {
  Download,
  Save,
  ArrowLeft,
  Clock,
  AlertCircle,
  RotateCcw,
  ShieldCheck,
  User,
  CheckCircle2,
  Trash2,
} from "lucide-react";
import { cn, Note } from "../lib/utils";
import { apiRequest } from "../lib/api";
import { jsPDF } from "jspdf";

interface NoteEditorProps {
  accessToken: string;
  note: Partial<Note>;
  onSave: (status?: "draft" | "final") => void;
  onDelete: () => void;
  isSaving: boolean;
  isDeleting: boolean;
  onCancel: () => void;
  onChange: (note: Partial<Note>) => void;
  onReprocess: () => void;
}

export const NoteEditor = ({
  accessToken,
  note,
  onSave,
  onDelete,
  isSaving,
  isDeleting,
  onCancel,
  onChange,
  onReprocess,
}: NoteEditorProps) => {
  const [patients, setPatients] = React.useState<any[]>([]);

  React.useEffect(() => {
    fetchPatients();
  }, [accessToken]);

  const fetchPatients = async () => {
    try {
      const data = await apiRequest<any[]>("/api/patients", accessToken);
      setPatients(data || []);
    } catch (error) {
      console.error("Failed to load patients", error);
    }
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    const patientName =
      patients.find((p) => String(p.id) === String(note.patient_id))?.name ||
      note.patient_id ||
      "Nao identificado";

    doc.setFontSize(22);
    doc.setTextColor(11, 91, 110);
    doc.text("Prontuario Clinico - SmartPSI", 20, 25);

    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Paciente: ${patientName}`, 20, 35);
    doc.text(
      `Data: ${new Date(note.created_at || new Date().toISOString()).toLocaleString()}`,
      20,
      40
    );

    const sections = [
      { title: "Queixa Principal", content: note.complaint },
      { title: "Intervencao Realizada", content: note.intervention },
      { title: "Proximo Foco", content: note.next_focus },
      { title: "Observacoes", content: note.observations || "Nenhuma observacao adicional." },
    ];

    let y = 55;
    sections.forEach((s) => {
      doc.setFontSize(12);
      doc.setTextColor(11, 91, 110);
      doc.setFont("helvetica", "bold");
      doc.text(s.title, 20, y);

      doc.setFontSize(11);
      doc.setTextColor(50);
      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(s.content || "", 170);
      doc.text(lines, 20, y + 7);
      y += lines.length * 6 + 20;
    });

    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      "Gerado automaticamente por SmartPSI. O audio original foi apagado para sua privacidade.",
      20,
      285
    );

    doc.save(`nota_${patientName}_${new Date().getTime()}.pdf`);
  };

  const missingForFinal: string[] = [];
  if (!note.patient_id) missingForFinal.push("paciente");
  if (!String(note.complaint || "").trim()) missingForFinal.push("queixa");
  if (!String(note.intervention || "").trim()) missingForFinal.push("intervencao");
  if (!String(note.next_focus || "").trim()) missingForFinal.push("proximo foco");
  const canFinalize = missingForFinal.length === 0;
  const canReprocess = note.source === "audio";

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <button
          onClick={onCancel}
          className="flex items-center gap-2 text-slate-500 hover:text-petroleum transition-colors"
        >
          <ArrowLeft size={20} />
          Voltar
        </button>
        <div className="flex items-center gap-3 flex-wrap">
          <span
            className={`text-xs font-bold px-3 py-1.5 rounded-full uppercase tracking-widest ${
              note.status === "final"
                ? "bg-success/10 text-success"
                : "bg-slate-700 text-white"
            }`}
          >
            {note.status === "final" ? "Final" : "Rascunho"}
          </span>
          <button
            onClick={exportPDF}
            disabled={isSaving || isDeleting}
            className="bg-white/50 backdrop-blur-sm border border-black/5 px-5 py-2.5 rounded-xl font-semibold text-slate-600 flex items-center gap-2 hover:bg-white/80 transition-all"
          >
            <Download size={18} />
            Exportar PDF
          </button>
          {note.id && (
            <button
              onClick={onDelete}
              disabled={isSaving || isDeleting}
              className="bg-error/10 text-error px-5 py-2.5 rounded-xl font-semibold flex items-center gap-2 hover:bg-error hover:text-white transition-all"
            >
              <Trash2 size={18} />
              {isDeleting ? "Excluindo..." : "Excluir"}
            </button>
          )}
          <button
            onClick={() => onSave(note.status === "final" ? "final" : "draft")}
            disabled={isSaving || isDeleting}
            className={cn(
              "text-white px-6 py-2.5 rounded-xl font-semibold shadow-lg flex items-center gap-2 hover:scale-105 active:scale-95 transition-all",
              note.status === "final"
                ? "bg-petroleum shadow-petroleum/20"
                : "bg-slate-800 shadow-slate-900/20"
            )}
          >
            <Save size={18} />
            {isSaving
              ? "Salvando..."
              : note.status === "final"
              ? "Salvar Alteracoes"
              : "Salvar Rascunho"}
          </button>
          {note.status !== "final" && (
            <button
              onClick={() => onSave("final")}
              disabled={!canFinalize || isSaving || isDeleting}
              className="bg-success text-white px-6 py-2.5 rounded-xl font-semibold shadow-lg shadow-success/20 flex items-center gap-2 hover:scale-105 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              <CheckCircle2 size={18} />
              {isSaving ? "Finalizando..." : "Finalizar Prontuario"}
            </button>
          )}
        </div>
      </div>

      <div className="glass-panel p-10 space-y-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-[0.15em] text-slate-400 flex items-center gap-2">
              <User size={14} />
              Identificacao do Paciente
            </label>
            <select
              value={String(note.patient_id ?? "")}
              onChange={(e) => onChange({ ...note, patient_id: e.target.value })}
              className="apple-input w-full text-lg font-semibold appearance-none"
            >
              <option value="">Selecione o paciente</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-[0.15em] text-slate-400 flex items-center gap-2">
              <Clock size={14} />
              Data e Hora da Sessao
            </label>
            <div className="apple-input w-full bg-slate-50/50 text-slate-500 font-medium flex items-center gap-2">
              {new Date(note.created_at || new Date().toISOString()).toLocaleString()}
            </div>
          </div>
        </div>

        {note.status !== "final" && !canFinalize && (
          <div className="bg-warning/10 border border-warning/20 text-warning rounded-xl px-4 py-3 text-sm">
            Para finalizar, complete: {missingForFinal.join(", ")}.
          </div>
        )}

        <div className="space-y-8">
          {[
            { id: "complaint", label: "Queixa Principal", rows: 4 },
            { id: "intervention", label: "Intervencao Realizada", rows: 4 },
            { id: "next_focus", label: "Proximo Foco", rows: 3 },
            { id: "observations", label: "Observacoes Adicionais", rows: 2 },
          ].map((field) => (
            <div key={field.id} className="space-y-3">
              <label className="text-xs font-bold uppercase tracking-[0.15em] text-slate-400 flex items-center justify-between">
                {field.label}
                {String((note as any)[field.id] || "").includes("Nao identificado") && (
                  <span className="text-error flex items-center gap-1 normal-case font-medium tracking-normal">
                    <AlertCircle size={14} />
                    Revisao necessaria
                  </span>
                )}
              </label>
              <textarea
                rows={field.rows}
                value={(note as any)[field.id] || ""}
                onChange={(e) => onChange({ ...note, [field.id]: e.target.value })}
                className="apple-input w-full resize-none leading-relaxed"
              />
            </div>
          ))}
        </div>

        <div className="pt-8 border-t border-black/5 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3 text-sm text-slate-400 font-medium">
            <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center text-success">
              <ShieldCheck size={18} />
            </div>
            Privacidade: O audio desta sessao foi apagado permanentemente.
          </div>
          {canReprocess && (
            <button
              onClick={onReprocess}
              className="text-sm text-petroleum font-bold flex items-center gap-2 hover:bg-petroleum/5 px-4 py-2 rounded-lg transition-all"
            >
              <RotateCcw size={16} />
              Reprocessar com IA
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
