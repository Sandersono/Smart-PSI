import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  Plus, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Calendar, 
  Filter,
  Download,
  ArrowUpRight,
  ArrowDownRight,
  MoreHorizontal
} from 'lucide-react';
import { cn } from '../lib/utils';

export const Financial = () => {
  const [records, setRecords] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newRecord, setNewRecord] = useState({
    patient_id: '',
    amount: '',
    type: 'income',
    category: 'Sessão',
    description: '',
    date: new Date().toISOString().split('T')[0],
    status: 'paid'
  });

  useEffect(() => {
    fetchFinancial();
  }, []);

  const fetchFinancial = async () => {
    const res = await fetch('/api/financial');
    const data = await res.json();
    setRecords(data);
  };

  const handleCreateRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/financial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newRecord)
    });
    if (res.ok) {
      fetchFinancial();
      setIsModalOpen(false);
      setNewRecord({ patient_id: '', amount: '', type: 'income', category: 'Sessão', description: '', date: new Date().toISOString().split('T')[0], status: 'paid' });
    }
  };

  const totalIncome = records.filter(r => r.type === 'income').reduce((acc, r) => acc + r.amount, 0);
  const totalExpense = records.filter(r => r.type === 'expense').reduce((acc, r) => acc + r.amount, 0);
  const balance = totalIncome - totalExpense;

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Financeiro</h2>
          <p className="text-slate-500">Controle suas receitas e despesas clínicas.</p>
        </div>
        <div className="flex gap-3">
          <button className="bg-white/50 backdrop-blur-sm border border-black/5 px-6 py-3 rounded-2xl font-semibold text-slate-600 flex items-center gap-2 hover:bg-white/80 transition-all">
            <Download size={20} />
            Relatórios
          </button>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-petroleum text-white px-6 py-3 rounded-2xl font-semibold shadow-lg shadow-petroleum/20 flex items-center gap-2 hover:scale-105 active:scale-95 transition-all"
          >
            <Plus size={20} />
            Novo Lançamento
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-panel p-8 bg-white/40">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-success/10 rounded-2xl flex items-center justify-center text-success">
              <TrendingUp size={24} />
            </div>
            <span className="text-xs font-bold text-success bg-success/10 px-2 py-1 rounded-lg">+12%</span>
          </div>
          <p className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-1">Receita Mensal</p>
          <h3 className="text-3xl font-bold text-petroleum">R$ {totalIncome.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
        </div>

        <div className="glass-panel p-8 bg-white/40">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-error/10 rounded-2xl flex items-center justify-center text-error">
              <TrendingDown size={24} />
            </div>
            <span className="text-xs font-bold text-error bg-error/10 px-2 py-1 rounded-lg">-5%</span>
          </div>
          <p className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-1">Despesas Mensais</p>
          <h3 className="text-3xl font-bold text-petroleum">R$ {totalExpense.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
        </div>

        <div className="glass-panel p-8 bg-petroleum text-white">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center">
              <DollarSign size={24} />
            </div>
          </div>
          <p className="text-sm font-bold text-white/50 uppercase tracking-wider mb-1">Saldo Líquido</p>
          <h3 className="text-3xl font-bold">R$ {balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
        </div>
      </div>

      <div className="glass-panel overflow-hidden">
        <div className="px-8 py-6 border-b border-black/5 flex items-center justify-between bg-white/40">
          <h3 className="text-xl font-bold">Últimas Transações</h3>
          <div className="flex gap-2">
            <button className="p-2 hover:bg-white/60 rounded-xl transition-all"><Filter size={20} /></button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs font-bold text-slate-400 uppercase tracking-widest bg-slate-50/50">
                <th className="px-8 py-4">Data</th>
                <th className="px-8 py-4">Descrição</th>
                <th className="px-8 py-4">Categoria</th>
                <th className="px-8 py-4">Valor</th>
                <th className="px-8 py-4">Status</th>
                <th className="px-8 py-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {records.map((record) => (
                <tr key={record.id} className="hover:bg-white/20 transition-colors group">
                  <td className="px-8 py-5 text-sm font-medium text-slate-500">
                    {new Date(record.date).toLocaleDateString()}
                  </td>
                  <td className="px-8 py-5">
                    <p className="font-bold text-slate-700">{record.description || record.patient_name || 'Lançamento Avulso'}</p>
                  </td>
                  <td className="px-8 py-5">
                    <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-lg uppercase tracking-wider">{record.category}</span>
                  </td>
                  <td className="px-8 py-5">
                    <div className={cn(
                      "flex items-center gap-1 font-bold",
                      record.type === 'income' ? "text-success" : "text-error"
                    )}>
                      {record.type === 'income' ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                      R$ {record.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <span className={cn(
                      "text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-widest",
                      record.status === 'paid' ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                    )}>
                      {record.status === 'paid' ? 'Pago' : 'Pendente'}
                    </span>
                  </td>
                  <td className="px-8 py-5 text-right">
                    <button className="p-2 text-slate-300 hover:text-petroleum transition-colors">
                      <MoreHorizontal size={20} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
              <h3 className="text-2xl font-bold">Novo Lançamento</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <Plus size={24} className="rotate-45" />
              </button>
            </div>

            <form onSubmit={handleCreateRecord} className="space-y-6">
              <div className="flex p-1 bg-slate-100 rounded-xl mb-6">
                <button 
                  type="button"
                  onClick={() => setNewRecord({...newRecord, type: 'income'})}
                  className={cn(
                    "flex-1 py-2 rounded-lg text-sm font-bold transition-all",
                    newRecord.type === 'income' ? "bg-white text-success shadow-sm" : "text-slate-500"
                  )}
                >
                  Receita
                </button>
                <button 
                  type="button"
                  onClick={() => setNewRecord({...newRecord, type: 'expense'})}
                  className={cn(
                    "flex-1 py-2 rounded-lg text-sm font-bold transition-all",
                    newRecord.type === 'expense' ? "bg-white text-error shadow-sm" : "text-slate-500"
                  )}
                >
                  Despesa
                </button>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Valor (R$)</label>
                <input 
                  required
                  type="number" 
                  step="0.01"
                  value={newRecord.amount}
                  onChange={(e) => setNewRecord({...newRecord, amount: e.target.value})}
                  className="apple-input w-full text-2xl font-bold text-petroleum"
                  placeholder="0,00"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Descrição</label>
                <input 
                  required
                  type="text" 
                  value={newRecord.description}
                  onChange={(e) => setNewRecord({...newRecord, description: e.target.value})}
                  className="apple-input w-full"
                  placeholder="Ex: Aluguel da sala, Sessão avulsa..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Data</label>
                  <input 
                    required
                    type="date" 
                    value={newRecord.date}
                    onChange={(e) => setNewRecord({...newRecord, date: e.target.value})}
                    className="apple-input w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Status</label>
                  <select 
                    value={newRecord.status}
                    onChange={(e) => setNewRecord({...newRecord, status: e.target.value})}
                    className="apple-input w-full appearance-none"
                  >
                    <option value="paid">Pago</option>
                    <option value="pending">Pendente</option>
                  </select>
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
                  Lançar
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};
