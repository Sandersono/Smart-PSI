import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  Plus, 
  Search, 
  User, 
  Mail, 
  Phone, 
  Calendar, 
  MapPin, 
  FileText,
  ChevronRight,
  MoreVertical,
  Trash2,
  Edit
} from 'lucide-react';
import { cn } from '../lib/utils';

interface PatientsProps {
  onSelectPatient: (patient: any) => void;
}

export const Patients = ({ onSelectPatient }: PatientsProps) => {
  const [patients, setPatients] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newPatient, setNewPatient] = useState({
    name: '',
    email: '',
    phone: '',
    birth_date: '',
    cpf: '',
    address: '',
    notes: ''
  });

  useEffect(() => {
    fetchPatients();
  }, []);

  const fetchPatients = async () => {
    const res = await fetch('/api/patients');
    const data = await res.json();
    setPatients(data);
  };

  const handleCreatePatient = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newPatient)
    });
    if (res.ok) {
      fetchPatients();
      setIsModalOpen(false);
      setNewPatient({ name: '', email: '', phone: '', birth_date: '', cpf: '', address: '', notes: '' });
    }
  };

  const filteredPatients = patients.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Pacientes</h2>
          <p className="text-slate-500">Gerencie o cadastro e histórico de seus pacientes.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredPatients.map((patient) => (
          <motion.div
            key={patient.id}
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={() => onSelectPatient(patient)}
            className="glass-card p-6 group relative cursor-pointer"
          >
            <div className="flex justify-between items-start mb-6">
              <div className="w-14 h-14 bg-petroleum/10 rounded-2xl flex items-center justify-center text-petroleum">
                <User size={28} />
              </div>
              <button className="text-slate-300 hover:text-slate-600 transition-colors">
                <MoreVertical size={20} />
              </button>
            </div>

            <h3 className="font-bold text-xl mb-4 group-hover:text-petroleum transition-colors">
              {patient.name}
            </h3>

            <div className="space-y-3 text-sm text-slate-500">
              <div className="flex items-center gap-2">
                <Mail size={14} className="text-slate-400" />
                {patient.email || 'Sem e-mail'}
              </div>
              <div className="flex items-center gap-2">
                <Phone size={14} className="text-slate-400" />
                {patient.phone || 'Sem telefone'}
              </div>
              <div className="flex items-center gap-2">
                <Calendar size={14} className="text-slate-400" />
                {patient.birth_date ? new Date(patient.birth_date).toLocaleDateString() : 'Sem data'}
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-black/5 flex items-center justify-between">
              <button className="text-xs font-bold text-petroleum uppercase tracking-wider hover:underline">
                {patient.session_count || 0} Sessões Realizadas
              </button>
              <ChevronRight size={18} className="text-slate-300" />
            </div>
          </motion.div>
        ))}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-panel w-full max-w-2xl p-8 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-2xl font-bold">Cadastrar Novo Paciente</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <Plus size={24} className="rotate-45" />
              </button>
            </div>

            <form onSubmit={handleCreatePatient} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Nome Completo</label>
                  <input 
                    required
                    type="text" 
                    value={newPatient.name}
                    onChange={(e) => setNewPatient({...newPatient, name: e.target.value})}
                    className="apple-input w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">E-mail</label>
                  <input 
                    type="email" 
                    value={newPatient.email}
                    onChange={(e) => setNewPatient({...newPatient, email: e.target.value})}
                    className="apple-input w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Telefone</label>
                  <input 
                    type="text" 
                    value={newPatient.phone}
                    onChange={(e) => setNewPatient({...newPatient, phone: e.target.value})}
                    className="apple-input w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Data de Nascimento</label>
                  <input 
                    type="date" 
                    value={newPatient.birth_date}
                    onChange={(e) => setNewPatient({...newPatient, birth_date: e.target.value})}
                    className="apple-input w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">CPF</label>
                  <input 
                    type="text" 
                    value={newPatient.cpf}
                    onChange={(e) => setNewPatient({...newPatient, cpf: e.target.value})}
                    className="apple-input w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Endereço</label>
                  <input 
                    type="text" 
                    value={newPatient.address}
                    onChange={(e) => setNewPatient({...newPatient, address: e.target.value})}
                    className="apple-input w-full"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Observações Iniciais</label>
                <textarea 
                  rows={3}
                  value={newPatient.notes}
                  onChange={(e) => setNewPatient({...newPatient, notes: e.target.value})}
                  className="apple-input w-full resize-none"
                />
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
                  className="bg-petroleum text-white px-8 py-3 rounded-xl font-semibold shadow-lg shadow-petroleum/20 hover:scale-105 active:scale-95 transition-all"
                >
                  Cadastrar Paciente
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};
