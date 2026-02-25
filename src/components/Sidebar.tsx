import React from "react";
import {
  LayoutDashboard,
  Mic,
  Users,
  CalendarDays,
  Wallet,
  Settings,
  HelpCircle,
  LogOut,
  User,
} from "lucide-react";
import { cn } from "../lib/utils";
import { Brand } from "./Brand";

interface SidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
  onSignOut: () => void;
  userName: string;
  userEmail: string;
  role: "admin" | "professional" | "secretary";
}

export const Sidebar = ({
  activeView,
  onViewChange,
  onSignOut,
  userName,
  userEmail,
  role,
}: SidebarProps) => {
  const clinicalItems = [
    { id: "dashboard", label: "Painel", icon: LayoutDashboard },
    { id: "record", label: "Nova Sessao", icon: Mic },
  ];

  const operationalItems = [
    { id: "patients", label: "Pacientes", icon: Users },
    { id: "agenda", label: "Agenda", icon: CalendarDays },
    { id: "financial", label: "Financeiro", icon: Wallet },
    { id: "settings", label: "Configuracoes", icon: Settings },
    { id: "help", label: "Ajuda e LGPD", icon: HelpCircle },
  ];

  const menuItems = role === "secretary" ? operationalItems : [...clinicalItems, ...operationalItems];

  return (
    <aside className="w-64 h-screen sticky top-0 bg-[linear-gradient(180deg,#141414_0%,#1A1A1A_45%,#222224_100%)] border-r border-[#3A3A3C] p-6 flex flex-col text-slate-100 shadow-[inset_-1px_0_0_rgba(255,255,255,0.04)]">
      <div className="mb-12 px-2">
        <Brand inverse />
      </div>

      <nav className="flex-1 space-y-2">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onViewChange(item.id)}
            className={cn("nav-item w-full", activeView === item.id && "nav-item-active")}
          >
            <item.icon size={20} />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="pt-6 border-t border-white/20 space-y-4">
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
