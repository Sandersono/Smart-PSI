import React from "react";
import {
  LayoutDashboard,
  Mic,
  Users,
  CalendarDays,
  Wallet,
  MessageCircle,
  Settings,
  HelpCircle,
  LogOut,
  User,
} from "lucide-react";
import { cn } from "../lib/utils";
import { Brand } from "./Brand";
import { ClinicWorkspaceView } from "../lib/workspaceRoutes";
import { UserRole } from "../lib/types";

interface SidebarProps {
  activeView: ClinicWorkspaceView;
  onViewChange: (view: ClinicWorkspaceView) => void;
  onSignOut: () => void;
  userName: string;
  userEmail: string;
  role: UserRole;
  platformRole?: "superadmin" | null;
  activeClinicId?: string;
  activeClinicName?: string | null;
  clinicOptions?: Array<{ id: string; label: string }>;
  onClinicChange?: (clinicId: string) => void;
  onOpenPlatform?: () => void;
}

type NavigationItem = {
  id: ClinicWorkspaceView;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
};

export const Sidebar = ({
  activeView,
  onViewChange,
  onSignOut,
  userName,
  userEmail,
  role,
  platformRole,
  activeClinicId,
  activeClinicName,
  clinicOptions = [],
  onClinicChange,
  onOpenPlatform,
}: SidebarProps) => {
  const clinicalItems: NavigationItem[] = [
    { id: "dashboard", label: "Painel", icon: LayoutDashboard },
    { id: "record", label: "Nova Sessao", icon: Mic },
  ];

  const operationalItems: NavigationItem[] = [
    { id: "patients", label: "Pacientes", icon: Users },
    { id: "agenda", label: "Agenda", icon: CalendarDays },
    { id: "inbox", label: "Atendimento", icon: MessageCircle },
    { id: "financial", label: "Financeiro", icon: Wallet },
    { id: "settings", label: "Configuracoes", icon: Settings },
    { id: "help", label: "Ajuda e LGPD", icon: HelpCircle },
  ];

  return (
    <aside className="w-64 h-screen sticky top-0 bg-[linear-gradient(180deg,#141414_0%,#1A1A1A_45%,#222224_100%)] border-r border-[#3A3A3C] p-6 flex flex-col text-slate-100 shadow-[inset_-1px_0_0_rgba(255,255,255,0.04)]">
      <div className="mb-12 px-2">
        <Brand inverse />
      </div>

      <nav className="flex-1 space-y-6">
        {role !== "secretary" ? (
          <div className="space-y-2">
            <p className="px-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
              Clinico
            </p>
            {clinicalItems.map((item) => (
              <button
                key={item.id}
                onClick={() => onViewChange(item.id)}
                className={cn("nav-item w-full", activeView === item.id && "nav-item-active")}
              >
                <item.icon size={20} />
                {item.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="space-y-2">
          <p className="px-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
            Operacao da clinica
          </p>
          {operationalItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={cn("nav-item w-full", activeView === item.id && "nav-item-active")}
            >
              <item.icon size={20} />
              {item.label}
            </button>
          ))}
        </div>
      </nav>

      <div className="pt-6 border-t border-white/20 space-y-4">
        {platformRole === "superadmin" && onOpenPlatform ? (
          <button
            onClick={onOpenPlatform}
            className="nav-item w-full border border-white/10 bg-white/5 hover:bg-white/10"
          >
            <Settings size={20} />
            Portal da plataforma
          </button>
        ) : null}

        <div className="px-2 space-y-2">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Clinica ativa</p>
          {clinicOptions.length > 1 && onClinicChange ? (
            <select
              value={activeClinicId || ""}
              onChange={(event) => onClinicChange(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-white/20 focus:bg-white/10"
            >
              {clinicOptions.map((clinic) => (
                <option key={clinic.id} value={clinic.id} className="bg-slate-900 text-slate-100">
                  {clinic.label}
                </option>
              ))}
            </select>
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200">
              {activeClinicName || "Clinica principal"}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 px-2">
          <div className="w-10 h-10 bg-slate-700 rounded-full flex items-center justify-center text-slate-100 border border-slate-500">
            <User size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate text-slate-100">{userName}</p>
            <p className="text-xs text-slate-300 truncate">{userEmail || "Conta autenticada"}</p>
          </div>
        </div>

        <button
          onClick={onSignOut}
          className="nav-item w-full text-rose-200 hover:text-white hover:bg-rose-500/20"
        >
          <LogOut size={20} />
          Sair
        </button>
      </div>
    </aside>
  );
};
