import React from 'react';
import { motion } from 'motion/react';
import { 
  LayoutDashboard, 
  Mic, 
  Users,
  CalendarDays,
  Wallet,
  Settings, 
  HelpCircle, 
  LogOut,
  User
} from 'lucide-react';
import { cn } from '../lib/utils';

interface SidebarProps {
  activeView: string;
  onViewChange: (view: any) => void;
}

export const Sidebar = ({ activeView, onViewChange }: SidebarProps) => {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'record', label: 'Nova Sessão', icon: Mic },
    { id: 'patients', label: 'Pacientes', icon: Users },
    { id: 'agenda', label: 'Agenda', icon: CalendarDays },
    { id: 'financial', label: 'Financeiro', icon: Wallet },
    { id: 'settings', label: 'Configurações', icon: Settings },
    { id: 'help', label: 'Ajuda & LGPD', icon: HelpCircle },
  ];

  return (
    <aside className="w-64 h-screen sticky top-0 bg-white/30 backdrop-blur-xl border-r border-white/20 p-6 flex flex-col">
      <div className="flex items-center gap-3 mb-12 px-2">
        <div className="w-10 h-10 bg-petroleum rounded-xl flex items-center justify-center text-white font-bold shadow-lg shadow-petroleum/20">
          S
        </div>
        <h1 className="text-xl font-bold text-petroleum tracking-tight">SmartPSI</h1>
      </div>

      <nav className="flex-1 space-y-2">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onViewChange(item.id)}
            className={cn(
              "nav-item w-full",
              activeView === item.id && "nav-item-active"
            )}
          >
            <item.icon size={20} />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="pt-6 border-t border-white/20 space-y-4">
        <div className="flex items-center gap-3 px-2">
          <div className="w-10 h-10 bg-slate-200 rounded-full flex items-center justify-center text-slate-600 border-2 border-white">
            <User size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">Dr. Ricardo Silva</p>
            <p className="text-xs text-slate-500 truncate">Psicólogo Clínico</p>
          </div>
        </div>
        
        <button className="nav-item w-full text-error hover:text-error hover:bg-error/5">
          <LogOut size={20} />
          Sair
        </button>
      </div>
    </aside>
  );
};
