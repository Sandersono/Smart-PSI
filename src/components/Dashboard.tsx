import React, { useEffect, useState } from "react";
import {
  Plus,
  FileText,
  Clock,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Zap,
  Shield,
  Mic,
} from "lucide-react";
import { cn, Note } from "../lib/utils";
import { apiRequest } from "../lib/api";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface DashboardProps {
  notes: Note[];
  accessToken: string;
  userName: string;
  onNewSession: () => void;
  onQuickNote: () => void;
  onOpenNote: (note: Note) => void;
}

type DashboardStats = {
  sessionsToday: number;
  pendingReview: number;
  timeSaved: string;
  avgProcessing: string;
  volumeData: Array<{ name: string; volume: number }>;
};

export const Dashboard = ({
  notes,
  accessToken,
  userName,
  onNewSession,
  onQuickNote,
  onOpenNote,
}: DashboardProps) => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [nextApp, setNextApp] = useState<any>(null);
  const [filter, setFilter] = useState<"all" | "today">("today");
  const [loadingStats, setLoadingStats] = useState(false);
  const [loadingNext, setLoadingNext] = useState(false);

  useEffect(() => {
    fetchStats();
    fetchNextAppointment();
  }, [accessToken]);

  const fetchStats = async () => {
    setLoadingStats(true);
    try {
      const data = await apiRequest<DashboardStats>("/api/stats", accessToken);
      setStats(data);
    } catch (error) {
      console.error("Failed to load stats", error);
    } finally {
      setLoadingStats(false);
    }
  };

  const fetchNextAppointment = async () => {
    setLoadingNext(true);
    try {
      const data = await apiRequest<any>("/api/appointments/next", accessToken);
      setNextApp(data);
    } catch (error) {
      console.error("Failed to load next appointment", error);
    } finally {
      setLoadingNext(false);
    }
  };

  const filteredNotes = notes.filter((note) => {
    if (filter === "all") return true;
    const today = new Date().toISOString().split("T")[0];
    return String(note.created_at || "").startsWith(today);
  });

  const StatCard = ({ icon: Icon, label, value, subtext, trend, trendValue, color }: any) => (
    <div className="glass-card p-6 flex flex-col justify-between min-h-[160px]">
      <div className="flex justify-between items-start">
        <div className={cn("p-3 rounded-2xl", color)}>
          <Icon size={24} />
        </div>
        {trend && (
          <div
            className={cn(
              "flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg",
              trend === "up" ? "text-success bg-success/10" : "text-error bg-error/10"
            )}
          >
            {trend === "up" ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {trendValue}
          </div>
        )}
      </div>
      <div>
        <p className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-1">{label}</p>
        <h3 className="text-3xl font-bold text-slate-800">{value}</h3>
        <p className="text-xs text-slate-400 mt-1">{subtext}</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-8 pb-12">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Olá, {userName}</h2>
          <p className="text-slate-500">
            Resumo de hoje,{" "}
            {new Date().toLocaleDateString("pt-BR", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            .
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onQuickNote}
            className="bg-white/50 backdrop-blur-sm border border-black/5 px-6 py-3 rounded-2xl font-semibold text-slate-600 flex items-center gap-2 hover:bg-white/80 transition-all"
          >
            <FileText size={20} />
            Nota rápida
          </button>
          <button
            onClick={onNewSession}
            className="bg-petroleum text-white px-6 py-3 rounded-2xl font-semibold shadow-lg shadow-petroleum/20 flex items-center gap-2 hover:scale-105 active:scale-95 transition-all"
          >
            <Plus size={20} />
            Nova sessão
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          icon={CalendarIcon}
          label="Sessões hoje"
          value={stats?.sessionsToday || 0}
          subtext={`${stats?.pendingReview || 0} pendentes de revisão`}
          trend="up"
          trendValue="12%"
          color="bg-blue-50 text-blue-500"
        />
        <StatCard
          icon={Clock}
          label="Tempo economizado"
          value={stats?.timeSaved || "0m"}
          subtext="Documentação do dia"
          trend="down"
          trendValue="18m"
          color="bg-emerald-50 text-emerald-500"
        />
        <StatCard
          icon={Zap}
          label="Processamento médio"
          value={stats?.avgProcessing || "0m"}
          subtext="Dentro da meta (< 2m)"
          color="bg-amber-50 text-amber-500"
        />
        <div className="glass-card p-6 bg-petroleum text-white flex flex-col justify-between min-h-[160px] border-none">
          <div className="flex justify-between items-start">
            <div className="p-3 bg-white/10 rounded-2xl">
              <Shield size={24} />
            </div>
            <span className="text-[10px] font-bold bg-white/20 px-2 py-1 rounded-full uppercase tracking-widest">
              Seguro
            </span>
          </div>
          <div>
            <p className="text-sm font-bold text-white/60 uppercase tracking-wider mb-1">
              Privacidade
            </p>
            <h3 className="text-2xl font-bold">Áudios removidos</h3>
            <p className="text-xs text-white/40 mt-1">100% conformidade LGPD</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="glass-panel p-8">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-xl font-bold">Prontuários recentes</h3>
              <div className="flex bg-slate-100 p-1 rounded-xl">
                <button
                  onClick={() => setFilter("all")}
                  className={cn(
                    "px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
                    filter === "all" ? "bg-white shadow-sm text-petroleum" : "text-slate-500"
                  )}
                >
                  Todos
                </button>
                <button
                  onClick={() => setFilter("today")}
                  className={cn(
                    "px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
                    filter === "today" ? "bg-white shadow-sm text-petroleum" : "text-slate-500"
                  )}
                >
                  Hoje
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {filteredNotes.slice(0, 5).map((note) => (
                <div
                  key={note.id}
                  onClick={() => onOpenNote(note)}
                  className="flex items-center gap-4 p-4 rounded-2xl border border-black/5 hover:bg-white/40 transition-all cursor-pointer group"
                >
                  <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 font-bold group-hover:bg-petroleum/10 group-hover:text-petroleum transition-colors">
                    {String(note.patient_name || "PN").substring(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold truncate">{note.patient_name || "Paciente sem nome"}</h4>
                      <span className="text-xs text-slate-400">#{note.id}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                      <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {new Date(note.created_at).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="truncate">Queixa: {note.complaint || "-"}</span>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-widest",
                      note.status === "final" ? "bg-success/10 text-success" : "bg-slate-700 text-white"
                    )}
                  >
                    {note.status === "final" ? "Finalizada" : "Rascunho"}
                  </span>
                </div>
              ))}

              {filteredNotes.length === 0 && (
                <div className="py-12 text-center text-slate-400">Nenhum prontuário para este filtro.</div>
              )}
            </div>

            <button
              onClick={() => setFilter("all")}
              className="w-full mt-8 py-3 text-sm font-bold text-petroleum hover:bg-petroleum/5 rounded-xl transition-all flex items-center justify-center gap-2"
            >
              Ver todos os prontuários <ChevronRight size={16} />
            </button>
          </div>

          <div className="glass-panel p-8">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-xl font-bold">Volume de atendimentos</h3>
                <p className="text-xs text-slate-400">Últimos 7 dias</p>
              </div>
            </div>
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats?.volumeData || []}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} dy={10} />
                  <YAxis hide />
                  <Tooltip cursor={{ fill: "#f8fafc" }} contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)" }} />
                  <Bar dataKey="volume" radius={[6, 6, 0, 0]}>
                    {(stats?.volumeData || []).map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.volume > 6 ? "#0B5B6E" : "#477a87"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="space-y-8">
          <div className="glass-panel p-8">
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6">
              Status do sistema
            </h3>
            <div className="space-y-4">
              <StatusRow label="Serviço de transcrição" />
              <StatusRow label="Geração de prontuários (LLM)" />
              <StatusRow label="Segurança de dados" />
            </div>
          </div>

          <div className="glass-panel p-8 bg-petroleum text-white border-none">
            <h3 className="text-xl font-bold mb-2">Próxima sessão</h3>
            <p className="text-white/60 text-sm mb-8 leading-relaxed">
              Inicie a gravação com um clique. Consentimento do paciente é obrigatório.
            </p>

            {!loadingNext && nextApp && (
              <div className="mb-8 p-4 bg-white/10 rounded-2xl border border-white/10">
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">
                  Próxima consulta
                </p>
                <p className="font-bold text-lg">{nextApp.patient_name || "Paciente"}</p>
                <p className="text-xs text-white/60 flex items-center gap-1 mt-1">
                  <Clock size={12} />
                  {new Date(nextApp.start_time).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            )}

            {!loadingNext && !nextApp && (
              <div className="mb-8 p-4 bg-white/10 rounded-2xl border border-white/10 text-sm text-white/70">
                Nenhum agendamento futuro encontrado.
              </div>
            )}

            <button
              onClick={onNewSession}
              className="w-full bg-white text-petroleum py-4 rounded-2xl font-bold shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              <Mic size={20} />
              Iniciar gravação
            </button>
          </div>
        </div>
      </div>

      {loadingStats && (
        <div className="text-xs text-slate-400">Atualizando métricas...</div>
      )}
    </div>
  );
};

const StatusRow = ({ label }: { label: string }) => (
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-3">
      <div className="w-1.5 h-1.5 bg-success rounded-full" />
      <span className="text-sm font-medium text-slate-600">{label}</span>
    </div>
    <span className="text-[10px] font-bold text-success bg-success/10 px-2 py-0.5 rounded-md">
      Online
    </span>
  </div>
);

const CalendarIcon = ({ size }: { size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);
