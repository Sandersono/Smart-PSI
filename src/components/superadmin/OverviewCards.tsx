import React from "react";
import { OverviewPayload } from "./types";

type OverviewCardsProps = {
  overview: OverviewPayload | null;
};

export function OverviewCards({ overview }: OverviewCardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
      {[
        ["Clinicas", overview?.totals.clinics_total || 0],
        ["Ativas", overview?.totals.active || 0],
        ["Teste", overview?.totals.trialing || 0],
        ["Atraso", overview?.totals.past_due || 0],
        ["Suspensas", overview?.totals.suspended || 0],
        ["Canceladas", overview?.totals.cancelled || 0],
        ["Bloqueadas", overview?.totals.blocked || 0],
        ["Membros", overview?.totals.members_total || 0],
      ].map(([label, value]) => (
        <div key={String(label)} className="glass-card p-4">
          <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
          <p className="text-2xl font-bold text-[#1A1A1A] mt-2">{String(value)}</p>
        </div>
      ))}
    </div>
  );
}
