import React from "react";
import { Building2, Search } from "lucide-react";
import { ClinicItem, statusLabels } from "./types";

type ClinicListPanelProps = {
  clinics: ClinicItem[];
  query: string;
  selectedClinicId: string | null;
  onQueryChange: (value: string) => void;
  onApplyFilter: () => void;
  onSelectClinic: (clinicId: string) => void;
};

export function ClinicListPanel({
  clinics,
  query,
  selectedClinicId,
  onQueryChange,
  onApplyFilter,
  onSelectClinic,
}: ClinicListPanelProps) {
  return (
    <div className="glass-panel p-5 h-fit space-y-4">
      <div className="flex items-center gap-2 text-petroleum font-bold uppercase text-xs tracking-wider">
        <Building2 size={16} /> Clinicas
      </div>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onApplyFilter();
            }
          }}
          placeholder="Buscar por clinica ou responsavel"
          className="apple-input w-full pl-10"
        />
      </div>

      <button
        onClick={onApplyFilter}
        className="w-full border border-petroleum/30 text-petroleum px-4 py-2.5 rounded-xl font-semibold text-sm"
      >
        Aplicar filtro
      </button>

      <div className="space-y-2 max-h-[50vh] overflow-auto pr-1">
        {clinics.length === 0 ? (
          <div className="text-sm text-slate-500 py-6 text-center">Nenhuma clinica encontrada.</div>
        ) : (
          clinics.map((clinic) => (
            <button
              key={clinic.id}
              onClick={() => onSelectClinic(clinic.id)}
              className={`w-full text-left rounded-2xl border p-3 transition-all ${
                selectedClinicId === clinic.id
                  ? "border-petroleum bg-petroleum/10"
                  : "border-slate-200 hover:border-petroleum/40 hover:bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-sm text-[#1A1A1A] line-clamp-1">{clinic.name}</p>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                    clinic.subscription.status === "active"
                      ? "bg-success/15 text-success"
                      : clinic.subscription.status === "trialing"
                        ? "bg-warning/15 text-warning"
                        : clinic.subscription.status === "past_due"
                          ? "bg-warning/20 text-[#9a6b00]"
                          : "bg-error/15 text-error"
                  }`}
                >
                  {statusLabels[clinic.subscription.status]}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                {clinic.owner_full_name || clinic.owner_email || clinic.owner_user_id}
              </p>
              <div className="mt-2 text-xs text-slate-500 flex items-center justify-between">
                <span>{clinic.members.active_members} membros</span>
                <span>{clinic.features.enabled_count} flags ativas</span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
