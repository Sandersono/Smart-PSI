import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  Plus, 
  Calendar as CalendarIcon, 
  Clock, 
  User, 
  ChevronLeft, 
  ChevronRight,
  ExternalLink,
  Video,
  MoreVertical,
  ArrowRight
} from 'lucide-react';
import { cn } from '../lib/utils';

export const Agenda = () => {
  const [appointments, setAppointments] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [newAppointment, setNewAppointment] = useState({
    patient_id: '',
    start_time: '',
    end_time: '',
    type: 'Sessão',
    is_online: true,
    notes: ''
  });

  useEffect(() => {
    fetchAppointments();
    fetchPatients();
  }, []);

  const fetchAppointments = async () => {
    const res = await fetch('/api/appointments');
    const data = await res.json();
    setAppointments(data);
  };

  const fetchPatients = async () => {
    const res = await fetch('/api/patients');
    const data = await res.json();
    setPatients(data);
  };

  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newAppointment)
    });
    if (res.ok) {
      fetchAppointments();
      setIsModalOpen(false);
      setNewAppointment({ patient_id: '', start_time: '', end_time: '', type: 'Sessão', is_online: true, notes: '' });
    }
  };

  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const renderCalendar = () => {
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();
    const totalDays = daysInMonth(year, month);
    const startDay = firstDayOfMonth(year, month);
    const days = [];

    // Empty slots for previous month
    for (let i = 0; i < startDay; i++) {
      days.push(<div key={`empty-${i}`} className="h-10" />);
    }

    for (let d = 1; d <= totalDays; d++) {
      const isToday = d === new Date().getDate() && month === new Date().getMonth() && year === new Date().getFullYear();
      const isSelected = d === selectedDate.getDate();
      
      days.push(
        <button
          key={d}
          onClick={() => setSelectedDate(new Date(year, month, d))}
          className={cn(
            "h-10 w-10 rounded-full flex items-center justify-center text-sm font-medium transition-all relative",
            isSelected ? "bg-petroleum text-white shadow-lg shadow-petroleum/20" : "hover:bg-slate-100 text-slate-600",
            isToday && !isSelected && "text-petroleum font-bold"
          )}
        >
          {d}
          {/* Dot for appointments */}
          {appointments.some(a => new Date(a.start_time).getDate() === d && new Date(a.start_time).getMonth() === month) && (
            <div className={cn("absolute bottom-1 w-1 h-1 rounded-full", isSelected ? "bg-white" : "bg-petroleum")} />
          )}
        </button>
      );
    }

    return days;
  };

  const selectedDateStr = selectedDate.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
  const dayAppointments = appointments.filter(a => {
    const d = new Date(a.start_time);
    return d.getDate() === selectedDate.getDate() && d.getMonth() === selectedDate.getMonth();
  });

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Agenda</h2>
          <p className="text-slate-500">{dayAppointments.length} atendimentos hoje</p>
        </div>
        <div className="flex gap-3">
          <button className="bg-white/50 backdrop-blur-sm border border-black/5 px-6 py-3 rounded-2xl font-semibold text-slate-600 flex items-center gap-2 hover:bg-white/80 transition-all">
            <ExternalLink size={20} />
            Google Agenda
          </button>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-petroleum text-white px-6 py-3 rounded-2xl font-semibold shadow-lg shadow-petroleum/20 flex items-center gap-2 hover:scale-105 active:scale-95 transition-all"
          >
            <Plus size={20} />
            Agendar
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Sidebar: Calendar */}
        <div className="lg:col-span-4 space-y-6">
          <div className="glass-panel p-6">
            <div className="flex items-center justify-between mb-6">
              <button onClick={() => setSelectedDate(new Date(selectedDate.setMonth(selectedDate.getMonth() - 1)))} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                <ChevronLeft size={20} className="text-slate-400" />
              </button>
              <h3 className="font-bold text-slate-700">
                {selectedDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^\w/, c => c.toUpperCase())}
              </h3>
              <button onClick={() => setSelectedDate(new Date(selectedDate.setMonth(selectedDate.getMonth() + 1)))} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                <ChevronRight size={20} className="text-slate-400" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center mb-2">
              {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => (
                <span key={d} className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{d}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {renderCalendar()}
            </div>

            <div className="mt-8 p-6 bg-blue-50/50 rounded-3xl border border-blue-100/50 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-white rounded-lg shadow-sm flex items-center justify-center">
                  <img src="https://www.gstatic.com/images/branding/product/1x/calendar_2020q4_48dp.png" alt="Google" className="w-5 h-5" />
                </div>
                <h4 className="font-bold text-sm text-slate-700">Google Agenda</h4>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Conecte sua conta Google para sincronizar automaticamente seus horários.
              </p>
              <button className="text-xs font-bold text-petroleum flex items-center gap-1 hover:underline">
                Conectar agora <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Main Content: Appointments List */}
        <div className="lg:col-span-8 space-y-6">
          <h3 className="text-xl font-bold px-2">{selectedDateStr}</h3>
          
          <div className="space-y-4">
            {dayAppointments.map((app) => {
              const startTime = new Date(app.start_time);
              const endTime = new Date(app.end_time);
              const duration = Math.round((endTime.getTime() - startTime.getTime()) / 60000);
              
              return (
                <motion.div 
                  key={app.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="glass-card p-6 flex items-center gap-8 group"
                >
                  <div className="w-20 text-center border-r border-black/5 pr-8">
                    <p className="text-xl font-bold text-slate-800">
                      {startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
                      {duration >= 60 ? `${Math.floor(duration/60)}h` : `${duration}min`}
                    </p>
                  </div>

                  <div className="flex-1 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400">
                        <User size={24} />
                      </div>
                      <div>
                        <h4 className="font-bold text-lg text-slate-800">{app.patient_name}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] font-bold text-petroleum bg-petroleum/10 px-2 py-0.5 rounded-md uppercase tracking-wider">Sessão</span>
                          <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                            <Video size={12} /> Online
                          </span>
                        </div>
                      </div>
                    </div>

                    <button className="bg-success/10 text-success px-6 py-2 rounded-xl font-bold text-sm hover:bg-success hover:text-white transition-all">
                      Iniciar
                    </button>
                  </div>
                </motion.div>
              );
            })}

            {/* Free Slot Placeholder */}
            <div className="border-2 border-dashed border-slate-200 rounded-[2rem] p-8 text-center space-y-2 group hover:border-petroleum/30 transition-all cursor-pointer">
              <p className="text-slate-400 font-medium">Horários livres a partir das 16:00</p>
              <button 
                onClick={() => setIsModalOpen(true)}
                className="text-petroleum font-bold text-sm flex items-center justify-center gap-2 mx-auto"
              >
                <Plus size={16} /> Agendar horário
              </button>
            </div>
          </div>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-panel w-full max-w-md p-8"
          >
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-2xl font-bold">Novo Agendamento</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <Plus size={24} className="rotate-45" />
              </button>
            </div>

            <form onSubmit={handleCreateAppointment} className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Paciente</label>
                <select 
                  required
                  value={newAppointment.patient_id}
                  onChange={(e) => setNewAppointment({...newAppointment, patient_id: e.target.value})}
                  className="apple-input w-full appearance-none"
                >
                  <option value="">Selecione um paciente</option>
                  {patients.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Início</label>
                  <input 
                    required
                    type="datetime-local" 
                    value={newAppointment.start_time}
                    onChange={(e) => setNewAppointment({...newAppointment, start_time: e.target.value})}
                    className="apple-input w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Fim</label>
                  <input 
                    required
                    type="datetime-local" 
                    value={newAppointment.end_time}
                    onChange={(e) => setNewAppointment({...newAppointment, end_time: e.target.value})}
                    className="apple-input w-full"
                  />
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
                  className="bg-petroleum text-white px-8 py-3 rounded-xl font-semibold shadow-lg shadow-petroleum/20 hover:scale-105 active:scale-95 transition-all"
                >
                  Agendar
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};
