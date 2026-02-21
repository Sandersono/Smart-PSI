import React from 'react';
import { motion } from 'motion/react';
import { 
  Download, 
  Save, 
  ArrowLeft, 
  Clock, 
  AlertCircle, 
  RotateCcw,
  ShieldCheck,
  User
} from 'lucide-react';
import { Note } from '../lib/utils';
import { jsPDF } from 'jspdf';

interface NoteEditorProps {
  note: Partial<Note>;
  onSave: () => void;
  onCancel: () => void;
  onChange: (note: Partial<Note>) => void;
  onReprocess: () => void;
}

export const NoteEditor = ({ note, onSave, onCancel, onChange, onReprocess }: NoteEditorProps) => {
  const [patients, setPatients] = React.useState<any[]>([]);

  React.useEffect(() => {
    fetchPatients();
  }, []);

  const fetchPatients = async () => {
    const res = await fetch('/api/patients');
    const data = await res.json();
    setPatients(data);
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    const patientName = patients.find(p => String(p.id) === String(note.patient_id))?.name || note.patient_id || 'Não identificado';
    
    doc.setFontSize(22);
    doc.setTextColor(11, 91, 110);
    doc.text("Nota Clínica - SmartPSI", 20, 25);
    
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Paciente: ${patientName}`, 20, 35);
    doc.text(`Data: ${new Date().toLocaleString()}`, 20, 40);
    
    const sections = [
      { title: "Queixa Principal", content: note.complaint },
      { title: "Intervenção Realizada", content: note.intervention },
      { title: "Próximo Foco", content: note.next_focus },
      { title: "Observações", content: note.observations || "Nenhuma observação adicional." }
    ];

    let y = 55;
    sections.forEach(s => {
      doc.setFontSize(12);
      doc.setTextColor(11, 91, 110);
      doc.setFont("helvetica", "bold");
      doc.text(s.title, 20, y);
      
      doc.setFontSize(11);
      doc.setTextColor(50);
      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(s.content || '', 170);
      doc.text(lines, 20, y + 7);
      y += (lines.length * 6) + 20;
    });

    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text("Gerado automaticamente por SmartPSI. O áudio original foi apagado para sua privacidade.", 20, 285);
    
    doc.save(`nota_${patientName}_${new Date().getTime()}.pdf`);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <button onClick={onCancel} className="flex items-center gap-2 text-slate-500 hover:text-petroleum transition-colors">
          <ArrowLeft size={20} />
          Voltar
        </button>
        <div className="flex items-center gap-3">
          <button 
            onClick={exportPDF}
            className="bg-white/50 backdrop-blur-sm border border-black/5 px-5 py-2.5 rounded-xl font-semibold text-slate-600 flex items-center gap-2 hover:bg-white/80 transition-all"
          >
            <Download size={18} />
            Exportar PDF
          </button>
          <button 
            onClick={onSave}
            className="bg-petroleum text-white px-6 py-2.5 rounded-xl font-semibold shadow-lg shadow-petroleum/20 flex items-center gap-2 hover:scale-105 active:scale-95 transition-all"
          >
            <Save size={18} />
            Salvar Nota
          </button>
        </div>
      </div>

      <div className="glass-panel p-10 space-y-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-[0.15em] text-slate-400 flex items-center gap-2">
              <User size={14} />
              Identificação do Paciente
            </label>
            <select 
              value={note.patient_id}
              onChange={(e) => onChange({...note, patient_id: e.target.value})}
              className="apple-input w-full text-lg font-semibold appearance-none"
            >
              <option value="">Selecione o paciente</option>
              {patients.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-[0.15em] text-slate-400 flex items-center gap-2">
              <Clock size={14} />
              Data e Hora da Sessão
            </label>
            <div className="apple-input w-full bg-slate-50/50 text-slate-500 font-medium flex items-center gap-2">
              {new Date().toLocaleString()}
            </div>
          </div>
        </div>

        <div className="space-y-8">
          {[
            { id: 'complaint', label: 'Queixa Principal', rows: 4 },
            { id: 'intervention', label: 'Intervenção Realizada', rows: 4 },
            { id: 'next_focus', label: 'Próximo Foco', rows: 3 },
            { id: 'observations', label: 'Observações Adicionais', rows: 2 }
          ].map((field) => (
            <div key={field.id} className="space-y-3">
              <label className="text-xs font-bold uppercase tracking-[0.15em] text-slate-400 flex items-center justify-between">
                {field.label}
                {(note as any)[field.id]?.includes('Não identificado') && (
                  <span className="text-error flex items-center gap-1 normal-case font-medium tracking-normal">
                    <AlertCircle size={14} />
                    Revisão necessária
                  </span>
                )}
              </label>
              <textarea 
                rows={field.rows}
                value={(note as any)[field.id]}
                onChange={(e) => onChange({...note, [field.id]: e.target.value})}
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
            Privacidade: O áudio desta sessão foi apagado permanentemente.
          </div>
          <button 
            onClick={onReprocess}
            className="text-sm text-petroleum font-bold flex items-center gap-2 hover:bg-petroleum/5 px-4 py-2 rounded-lg transition-all"
          >
            <RotateCcw size={16} />
            Reprocessar com IA
          </button>
        </div>
      </div>
    </div>
  );
};
