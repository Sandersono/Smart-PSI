import React from 'react';
import { 
  User, 
  Bell, 
  Shield, 
  Database, 
  Globe, 
  Moon,
  ChevronRight,
  Check
} from 'lucide-react';

export const Settings = () => {
  const sections = [
    {
      title: "Perfil Profissional",
      icon: User,
      items: [
        { label: "Nome Completo", value: "Dr. Ricardo Silva" },
        { label: "E-mail", value: "ricardo.silva@exemplo.com" },
        { label: "CRP", value: "06/123456" }
      ]
    },
    {
      title: "Preferências de Notas",
      icon: Database,
      items: [
        { label: "Tom da Nota", value: "Objetivo / Clínico" },
        { label: "Comprimento", value: "Médio" },
        { label: "Idioma de Saída", value: "Português (Brasil)" }
      ]
    },
    {
      title: "Segurança e Privacidade",
      icon: Shield,
      items: [
        { label: "Autenticação em Duas Etapas", value: "Ativado", status: "success" },
        { label: "Retenção de Áudio", value: "0 segundos (Imediato)", status: "success" },
        { label: "Criptografia de Notas", value: "AES-256", status: "success" }
      ]
    }
  ];

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Configurações</h2>
        <p className="text-slate-500">Personalize sua experiência no SmartPSI.</p>
      </div>

      <div className="space-y-6">
        {sections.map((section) => (
          <div key={section.title} className="glass-panel overflow-hidden">
            <div className="px-8 py-4 bg-white/40 border-b border-black/5 flex items-center gap-3">
              <section.icon size={20} className="text-petroleum" />
              <h3 className="font-bold text-petroleum uppercase tracking-wider text-sm">{section.title}</h3>
            </div>
            <div className="divide-y divide-black/5">
              {section.items.map((item) => (
                <div key={item.label} className="px-8 py-5 flex items-center justify-between hover:bg-white/20 transition-colors cursor-pointer group">
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">{item.label}</p>
                    <p className="text-lg font-medium text-slate-700">{item.value}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {item.status === 'success' && <Check size={18} className="text-success" />}
                    <ChevronRight size={20} className="text-slate-300 group-hover:text-petroleum transition-all" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="glass-panel p-8 bg-error/5 border-error/10">
        <h3 className="text-error font-bold mb-2">Zona de Perigo</h3>
        <p className="text-sm text-error/70 mb-6">Ações irreversíveis relacionadas à sua conta e dados.</p>
        <div className="flex flex-wrap gap-4">
          <button className="bg-error text-white px-6 py-2.5 rounded-xl font-semibold shadow-lg shadow-error/20 hover:scale-105 active:scale-95 transition-all">
            Excluir Todas as Notas
          </button>
          <button className="bg-white border border-error/20 text-error px-6 py-2.5 rounded-xl font-semibold hover:bg-error/5 transition-all">
            Desativar Conta
          </button>
        </div>
      </div>
    </div>
  );
};
