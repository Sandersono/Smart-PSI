import React from "react";
import { CirclePlus } from "lucide-react";
import { Switch } from "../Switch";
import {
  BillingProvider,
  CreateClinicFlash,
  CreateClinicFormState,
  TenantStatus,
  defaultCreateClinicFeatures,
  featureLabels,
} from "./types";

type CreateClinicPanelProps = {
  form: CreateClinicFormState;
  selectedFeatures: string[];
  creatingClinic: boolean;
  flash: CreateClinicFlash | null;
  onFormChange: React.Dispatch<React.SetStateAction<CreateClinicFormState>>;
  onToggleFeature: (featureKey: string) => void;
  onSelectAllFeatures: () => void;
  onClearFeatures: () => void;
  onSubmit: (event: React.FormEvent) => void;
};

export function CreateClinicPanel({
  form,
  selectedFeatures,
  creatingClinic,
  flash,
  onFormChange,
  onToggleFeature,
  onSelectAllFeatures,
  onClearFeatures,
  onSubmit,
}: CreateClinicPanelProps) {
  return (
    <form onSubmit={onSubmit} className="glass-panel p-5 h-fit space-y-4">
      <div className="flex items-center gap-2 text-petroleum font-bold uppercase text-xs tracking-wider">
        <CirclePlus size={16} /> Cadastrar empresa
      </div>
      <label className="text-sm space-y-1 block">
        <span className="text-slate-600">Nome da empresa/clinica</span>
        <input
          value={form.name}
          onChange={(event) => onFormChange((prev) => ({ ...prev, name: event.target.value }))}
          className="apple-input w-full"
          placeholder="Ex.: Clinica SmartPSI Centro"
        />
      </label>
      <label className="text-sm space-y-1 block">
        <span className="text-slate-600">Email do responsavel (conta principal)</span>
        <input
          type="email"
          value={form.owner_email}
          onChange={(event) => onFormChange((prev) => ({ ...prev, owner_email: event.target.value }))}
          className="apple-input w-full"
          placeholder="responsavel@empresa.com"
        />
      </label>
      <label className="text-sm space-y-1 block">
        <span className="text-slate-600">Nome completo do responsavel (opcional)</span>
        <input
          value={form.owner_full_name}
          onChange={(event) => onFormChange((prev) => ({ ...prev, owner_full_name: event.target.value }))}
          className="apple-input w-full"
          placeholder="Nome do admin da empresa"
        />
      </label>
      <label className="text-sm space-y-1 block">
        <span className="text-slate-600">Senha inicial (opcional)</span>
        <input
          value={form.owner_password}
          onChange={(event) => onFormChange((prev) => ({ ...prev, owner_password: event.target.value }))}
          className="apple-input w-full"
          placeholder="Deixe vazio para gerar automatica"
        />
      </label>
      <div className="grid grid-cols-1 gap-3">
        <label className="text-sm space-y-1">
          <span className="text-slate-600">Plano inicial</span>
          <input
            value={form.plan_code}
            onChange={(event) => onFormChange((prev) => ({ ...prev, plan_code: event.target.value }))}
            className="apple-input w-full"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm space-y-1">
            <span className="text-slate-600">Status</span>
            <select
              value={form.status}
              onChange={(event) =>
                onFormChange((prev) => ({
                  ...prev,
                  status: event.target.value as TenantStatus,
                }))
              }
              className="apple-input w-full"
            >
              <option value="trialing">Teste</option>
              <option value="active">Ativa</option>
              <option value="past_due">Em atraso</option>
              <option value="suspended">Suspensa</option>
              <option value="cancelled">Cancelada</option>
            </select>
          </label>
          <label className="text-sm space-y-1">
            <span className="text-slate-600">Cobranca</span>
            <select
              value={form.billing_provider}
              onChange={(event) =>
                onFormChange((prev) => ({
                  ...prev,
                  billing_provider: event.target.value as BillingProvider,
                }))
              }
              className="apple-input w-full"
            >
              <option value="manual">Manual</option>
              <option value="asaas">Asaas</option>
            </select>
          </label>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-xs uppercase tracking-wider text-slate-500">
          <span>Flags iniciais</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onSelectAllFeatures} className="text-petroleum font-semibold">
              Marcar todas
            </button>
            <button type="button" onClick={onClearFeatures} className="text-slate-500 font-semibold">
              Limpar
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          {defaultCreateClinicFeatures.map((featureKey) => {
            const checked = selectedFeatures.includes(featureKey);
            return (
              <label key={featureKey} className="flex items-center gap-3 text-sm text-slate-700 cursor-pointer">
                <Switch checked={checked} onChange={() => onToggleFeature(featureKey)} />
                <span>{featureLabels[featureKey] || featureKey}</span>
              </label>
            );
          })}
        </div>
      </div>

      <button
        type="submit"
        disabled={creatingClinic}
        className="w-full bg-petroleum text-white px-4 py-2.5 rounded-xl font-semibold text-sm disabled:opacity-60"
      >
        {creatingClinic ? "Cadastrando..." : "Cadastrar empresa"}
      </button>

      {flash && (
        <div className="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm text-slate-700 space-y-1">
          <p className="font-semibold text-success">Empresa criada: {flash.clinic_name}</p>
          <p>
            Responsavel: {flash.owner_email || "email nao informado"} |{" "}
            {flash.owner_created ? "usuario criado agora" : "usuario existente"}
          </p>
          {flash.temporary_password && (
            <p className="font-mono text-xs break-all">Senha temporaria: {flash.temporary_password}</p>
          )}
        </div>
      )}
    </form>
  );
}
