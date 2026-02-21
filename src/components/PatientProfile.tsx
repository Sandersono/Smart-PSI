import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  ArrowLeft, 
  User, 
  Mail, 
  Phone, 
  Calendar, 
  FileText, 
  Clock, 
  DollarSign, 
  ChevronRight,
  Plus,
  Activity,
  ShieldCheck,
  TrendingUp
} from 'lucide-react';
import { cn } from '../lib/utils';

interface PatientProfileProps {
  patient: any;
  onBack: () => void;
  onNewSession: (patientId: string) => void;
}

export const PatientProfile = ({ patient, onBack, onNewSession }: PatientProfileProps) => {
  const [history, setHistory] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'timeline' | 'notes' | 'financial'>('timeline');

  useEffect(() => {
    fetchHistory();
  }, [patient.id]);

  const fetchHistory = async () => {
    const res = await fetch(`/api/patients/${patient.id}/history`);
    const data = await res.json();
    setHistory(data);
  };

  const timelineItems = history ? [
    ...history.notes.map((n: any) => ({ ...n, type: 'note', date: n.created_at })),
    ...history.appointments.map((a: any) => ({ ...a, type: 'appointment', date: a.start_time })),
    ...history.financial.map((f: any) => ({ ...f, type: 'financial', date: f.date }))
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) : [];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-slate-500 hover:text-petroleum transition-colors">
          <ArrowLeft size={20} />
          Voltar para Pacientes
        </button>
        <button 
          onClick={() => onNewSession(patient.id)}
          className="bg-petroleum text-white px-6 py-3 rounded-2xl font-semibold shadow-lg shadow-petroleum/20 flex items-center gap-2 hover:scale-105 active:scale-95 transition-all"
        >
          <Plus size={20} />
          Nova Sessão
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Patient Info Card */}
        <div className="lg:col-span-1 space-y-6">
          <div className="glass-panel p-8 text-center space-y-6">
            <div className="w-24 h-24 bg-petroleum/10 rounded-[2rem] flex items-center justify-center text-petroleum mx-auto shadow-inner">
              <User size={48} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-800">{patient.name}</h2>
              <p className="text-slate-500 font-medium">Paciente desde {new Date(patient.created_at).toLocaleDateString()}</p>
            </div>
            
            <div className="space-y-4 text-left pt-6 border-t border-black/5">
              <div className="flex items-center gap-3 text-slate-600">
                <Mail size={18} className="text-slate-400" />
                <span className="text-sm truncate">{patient.email || 'Não informado'}</span>
              </div>
              <div className="flex items-center gap-3 text-slate-600">
                <Phone size={18} className="text-slate-400" />
                <span className="text-sm">{patient.phone || 'Não informado'}</span>
              </div>
              <div className="flex items-center gap-3 text-slate-600">
                <Calendar size={18} className="text-slate-400" />
                <span className="text-sm">{patient.birth_date ? new Date(patient.birth_date).toLocaleDateString() : 'Não informado'}</span>
              </div>
            </div>

            <div className="pt-6 border-t border-black/5 grid grid-cols-2 gap-4">
              <div className="text-center">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Sessões</p>
                <p className="text-xl font-bold text-petroleum">{history?.notes.length || 0}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Pago</p>
                <p className="text-xl font-bold text-success">
                  R$ {history?.financial.filter((f:any) => f.type === 'income').reduce((acc:number, f:any) => acc + f.amount, 0).toLocaleString('pt-BR')}
                </p>
              </div>
            </div>
          </div>

          <div className="glass-panel p-6 bg-petroleum text-white border-none">
            <h3 className="font-bold mb-4 flex items-center gap-2">
              <ShieldCheck size={18} />
              Observações Clínicas
            </h3>
            <p className="text-sm text-white/70 leading-relaxed">
              {patient.notes || 'Nenhuma observação clínica registrada para este paciente.'}
            </p>
            <button className="mt-6 w-full bg-white/10 hover:bg-white/20 text-white py-3 rounded-xl text-xs font-bold transition-all">
              Editar Prontuário
            </button>
          </div>
        </div>

        {/* Timeline Content */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex bg-white/40 backdrop-blur-md p-1 rounded-2xl border border-white/60 w-fit">
            {[
              { id: 'timeline', label: 'Linha do Tempo', icon: Activity },
              { id: 'notes', label: 'Notas Clínicas', icon: FileText },
              { id: 'financial', label: 'Financeiro', icon: DollarSign }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
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

          <div className="space-y-4">
            {activeTab === 'timeline' && timelineItems.map((item, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="glass-card p-6 flex items-start gap-6 relative overflow-hidden"
              >
                {/* Type Indicator Line */}
                <div className={cn(
                  "absolute left-0 top-0 bottom-0 w-1.5",
                  item.type === 'note' ? "bg-petroleum" : item.type === 'appointment' ? "bg-warning" : "bg-success"
                )} />

                <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400 shrink-0">
                  {item.type === 'note' && <FileText size={24} />}
                  {item.type === 'appointment' && <Calendar size={24} />}
                  {item.type === 'financial' && <DollarSign size={24} />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-1">
                    <h4 className="font-bold text-lg text-slate-800">
                      {item.type === 'note' && 'Sessão de Psicoterapia'}
                      {item.type === 'appointment' && 'Agendamento de Sessão'}
                      {item.type === 'financial' && (item.type === 'income' ? 'Recebimento' : 'Lançamento Financeiro')}
                    </h4>
                    <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">
                      {new Date(item.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                  
                  <p className="text-sm text-slate-500 line-clamp-2 leading-relaxed">
                    {item.type === 'note' && (
                      <>
                        <span className="font-bold text-slate-700">Queixa:</span> {item.complaint}
                        <br />
                        <span className="font-bold text-slate-700">Intervenção:</span> {item.intervention}
                      </>
                    )}
                    {item.type === 'appointment' && `Horário: ${new Date(item.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                    {item.type === 'financial' && `${item.description || 'Pagamento de sessão'} - R$ ${item.amount.toLocaleString('pt-BR')}`}
                  </p>

                  <div className="mt-4 flex items-center gap-4">
                    <button className="text-xs font-bold text-petroleum hover:underline flex items-center gap-1">
                      Ver detalhes <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}

            {activeTab === 'timeline' && timelineItems.length === 0 && (
              <div className="py-24 text-center glass-panel">
                <p className="text-slate-400">Nenhuma atividade registrada para este paciente.</p>
              </div>
            )}
            
            {/* Other tabs would filter the timelineItems similarly */}
          </div>
        </div>
      </div>
    </div>
  );
};
