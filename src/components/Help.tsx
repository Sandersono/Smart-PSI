import React from 'react';
import { 
  HelpCircle, 
  ShieldCheck, 
  MessageCircle, 
  BookOpen,
  ExternalLink,
  ChevronRight
} from 'lucide-react';

export const Help = () => {
  const faqs = [
    {
      q: "O SmartPSI armazena o áudio das minhas sessões?",
      a: "Não. O áudio é processado em tempo real e apagado permanentemente dos nossos servidores assim que a nota clínica é gerada. Não mantemos cópias de áudio."
    },
    {
      q: "Como funciona a conformidade com a LGPD?",
      a: "O SmartPSI foi projetado seguindo os princípios de 'Privacy by Design'. Minimizamos a coleta de dados, utilizamos criptografia de ponta a ponta e garantimos que o profissional tenha controle total sobre as notas geradas."
    },
    {
      q: "A IA pode cometer erros na nota?",
      a: "Sim, como qualquer ferramenta de IA. Recomendamos sempre revisar a nota gerada. O sistema sinaliza campos onde a confiança na extração foi baixa."
    }
  ];

  return (
    <div className="max-w-4xl space-y-12">
      <div className="text-center space-y-4">
        <div className="w-20 h-20 bg-petroleum/10 rounded-3xl flex items-center justify-center mx-auto text-petroleum">
          <HelpCircle size={40} />
        </div>
        <h2 className="text-4xl font-bold tracking-tight">Como podemos ajudar?</h2>
        <p className="text-slate-500 text-lg">Suporte, documentação e compromisso com sua privacidade.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-panel p-8 space-y-4 hover:bg-white/80 transition-all cursor-pointer group">
          <div className="w-12 h-12 bg-petroleum rounded-2xl flex items-center justify-center text-white shadow-lg shadow-petroleum/20">
            <BookOpen size={24} />
          </div>
          <h3 className="text-xl font-bold">Guia de Uso Rápido</h3>
          <p className="text-slate-500">Aprenda a tirar o máximo proveito das notas geradas por IA em menos de 5 minutos.</p>
          <div className="flex items-center gap-2 text-petroleum font-bold text-sm pt-2">
            Ler Guia <ChevronRight size={16} />
          </div>
        </div>

        <div className="glass-panel p-8 space-y-4 hover:bg-white/80 transition-all cursor-pointer group">
          <div className="w-12 h-12 bg-success rounded-2xl flex items-center justify-center text-white shadow-lg shadow-success/20">
            <ShieldCheck size={24} />
          </div>
          <h3 className="text-xl font-bold">Política de Privacidade</h3>
          <p className="text-slate-500">Entenda detalhadamente como protegemos seus dados e os de seus pacientes.</p>
          <div className="flex items-center gap-2 text-success font-bold text-sm pt-2">
            Ver Política <ChevronRight size={16} />
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <h3 className="text-2xl font-bold px-4">Perguntas Frequentes</h3>
        <div className="space-y-4">
          {faqs.map((faq, i) => (
            <div key={i} className="glass-panel p-8 space-y-3">
              <h4 className="text-lg font-bold text-petroleum">{faq.q}</h4>
              <p className="text-slate-600 leading-relaxed">{faq.a}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-panel p-10 bg-petroleum text-white text-center space-y-6">
        <h3 className="text-2xl font-bold">Ainda tem dúvidas?</h3>
        <p className="text-white/70 max-w-md mx-auto">Nossa equipe de suporte está pronta para ajudar você com qualquer questão técnica ou ética.</p>
        <button className="bg-white text-petroleum px-8 py-3 rounded-2xl font-bold shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center gap-2 mx-auto">
          <MessageCircle size={20} />
          Falar com Suporte
        </button>
      </div>
    </div>
  );
};
