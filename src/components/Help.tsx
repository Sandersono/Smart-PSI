import React from "react";
import {
  HelpCircle,
  ShieldCheck,
  MessageCircle,
  BookOpen,
  ExternalLink,
} from "lucide-react";

export const Help = () => {
  const faqs = [
    {
      q: "O SmartPSI armazena o audio das sessoes?",
      a: "Nao. O audio e processado e descartado apos a geracao da nota clinica.",
    },
    {
      q: "A IA pode cometer erros na nota?",
      a: "Sim. Sempre revise e valide o conteudo antes de concluir o prontuario.",
    },
    {
      q: "Como funciona a privacidade dos dados?",
      a: "Os dados do sistema ficam por usuario e com controles de acesso via Supabase Auth e RLS.",
    },
  ];

  return (
    <div className="max-w-4xl space-y-12">
      <div className="text-center space-y-4">
        <div className="w-20 h-20 bg-petroleum/10 rounded-3xl flex items-center justify-center mx-auto text-petroleum">
          <HelpCircle size={40} />
        </div>
        <h2 className="text-4xl font-bold tracking-tight">Ajuda e suporte</h2>
        <p className="text-slate-500 text-lg">
          Guias rapidos, orientacoes de privacidade e canal de atendimento.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <a
          href="https://supabase.com/docs/guides/auth"
          target="_blank"
          rel="noreferrer"
          className="glass-panel p-8 space-y-4 hover:bg-white/80 transition-all cursor-pointer group"
        >
          <div className="w-12 h-12 bg-petroleum rounded-2xl flex items-center justify-center text-white shadow-lg shadow-petroleum/20">
            <BookOpen size={24} />
          </div>
          <h3 className="text-xl font-bold">Guia rapido de autenticacao</h3>
          <p className="text-slate-500">
            Referencia oficial do Supabase Auth para diagnostico de login e sessao.
          </p>
          <div className="flex items-center gap-2 text-petroleum font-bold text-sm pt-2">
            Abrir guia <ExternalLink size={16} />
          </div>
        </a>

        <a
          href="https://supabase.com/docs/guides/database/postgres/row-level-security"
          target="_blank"
          rel="noreferrer"
          className="glass-panel p-8 space-y-4 hover:bg-white/80 transition-all cursor-pointer group"
        >
          <div className="w-12 h-12 bg-success rounded-2xl flex items-center justify-center text-white shadow-lg shadow-success/20">
            <ShieldCheck size={24} />
          </div>
          <h3 className="text-xl font-bold">Privacidade e controle de acesso</h3>
          <p className="text-slate-500">
            Entenda como as politicas RLS protegem os dados por usuario.
          </p>
          <div className="flex items-center gap-2 text-success font-bold text-sm pt-2">
            Ver documentacao <ExternalLink size={16} />
          </div>
        </a>
      </div>

      <div className="space-y-4">
        <h3 className="text-2xl font-bold px-1">Perguntas frequentes</h3>
        {faqs.map((faq, idx) => (
          <div key={idx} className="glass-panel p-8 space-y-3">
            <h4 className="text-lg font-bold text-petroleum">{faq.q}</h4>
            <p className="text-slate-600 leading-relaxed">{faq.a}</p>
          </div>
        ))}
      </div>

      <div className="glass-panel p-10 bg-petroleum text-white text-center space-y-6">
        <h3 className="text-2xl font-bold">Precisa de suporte humano?</h3>
        <p className="text-white/70 max-w-md mx-auto">
          Em caso de erro recorrente, envie detalhes do problema e horario da ocorrencia.
        </p>
        <a
          href="mailto:suporte@smartpsi.app?subject=Suporte%20SmartPSI"
          className="inline-flex bg-white text-petroleum px-8 py-3 rounded-2xl font-bold shadow-xl hover:scale-105 active:scale-95 transition-all items-center gap-2"
        >
          <MessageCircle size={20} />
          Falar com suporte
        </a>
      </div>
    </div>
  );
};
