import React from "react";
import { BookOpenText, History, Loader2, Save, ShieldCheck } from "lucide-react";
import {
  AuditLog,
  BillingProvider,
  ClinicItem,
  FeatureFlag,
  SubscriptionFormState,
  TenantStatus,
  featureLabels,
  toLocalDateTime,
} from "./types";

type ClinicWorkspaceProps = {
  selectedClinic: ClinicItem | null;
  subscriptionForm: SubscriptionFormState;
  features: FeatureFlag[];
  auditLogs: AuditLog[];
  loadingFeatures: boolean;
  savingSubscription: boolean;
  syncingAsaas: boolean;
  savingFeatureKey: string | null;
  onSubscriptionFormChange: React.Dispatch<React.SetStateAction<SubscriptionFormState>>;
  onSaveSubscription: (event: React.FormEvent) => void;
  onSyncAsaasSubscription: () => void;
  onToggleFeature: (featureKey: string, nextEnabled: boolean) => void;
};

export function ClinicWorkspace({
  selectedClinic,
  subscriptionForm,
  features,
  auditLogs,
  loadingFeatures,
  savingSubscription,
  syncingAsaas,
  savingFeatureKey,
  onSubscriptionFormChange,
  onSaveSubscription,
  onSyncAsaasSubscription,
  onToggleFeature,
}: ClinicWorkspaceProps) {
  if (!selectedClinic) {
    return <div className="glass-panel p-8 text-slate-500">Selecione uma clinica para iniciar a gestao.</div>;
  }

  return (
    <div className="grid grid-cols-1 2xl:grid-cols-[1.15fr_0.85fr] gap-6">
      <article className="glass-panel p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-[#1A1A1A]">{selectedClinic.name}</h2>
            <p className="text-sm text-slate-500 mt-1">
              Criada em {toLocalDateTime(selectedClinic.created_at)} | Responsavel:{" "}
              {selectedClinic.owner_email || selectedClinic.owner_user_id}
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold text-[#1A1A1A]">Membros ativos: {selectedClinic.members.active_members}</p>
            <p className="text-slate-500">
              Admin {selectedClinic.members.roles.admin} | Profissionais {selectedClinic.members.roles.professional} |
              Secretaria {selectedClinic.members.roles.secretary}
            </p>
          </div>
        </div>

        <form onSubmit={onSaveSubscription} className="space-y-4">
          <div className="flex items-center gap-2 text-petroleum font-bold uppercase text-xs tracking-wider">
            <ShieldCheck size={16} /> Assinatura e bloqueio
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <label className="text-sm space-y-1">
              <span className="text-slate-600">Plano</span>
              <input
                value={subscriptionForm.plan_code}
                onChange={(event) => onSubscriptionFormChange((prev) => ({ ...prev, plan_code: event.target.value }))}
                className="apple-input w-full"
              />
            </label>

            <label className="text-sm space-y-1">
              <span className="text-slate-600">Status</span>
              <select
                value={subscriptionForm.status}
                onChange={(event) =>
                  onSubscriptionFormChange((prev) => ({
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
              <span className="text-slate-600">Provedor</span>
              <select
                value={subscriptionForm.billing_provider}
                onChange={(event) =>
                  onSubscriptionFormChange((prev) => ({
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

          <div className="grid md:grid-cols-2 gap-4">
            <label className="text-sm space-y-1">
              <span className="text-slate-600">Asaas customer id</span>
              <input
                value={subscriptionForm.asaas_customer_id}
                onChange={(event) =>
                  onSubscriptionFormChange((prev) => ({
                    ...prev,
                    asaas_customer_id: event.target.value,
                  }))
                }
                className="apple-input w-full"
              />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-slate-600">Asaas subscription id</span>
              <input
                value={subscriptionForm.asaas_subscription_id}
                onChange={(event) =>
                  onSubscriptionFormChange((prev) => ({
                    ...prev,
                    asaas_subscription_id: event.target.value,
                  }))
                }
                className="apple-input w-full"
              />
            </label>
          </div>

          <div className="grid md:grid-cols-4 gap-4">
            <label className="text-sm space-y-1">
              <span className="text-slate-600">Fim de teste</span>
              <input
                type="date"
                value={subscriptionForm.trial_ends_at}
                onChange={(event) =>
                  onSubscriptionFormChange((prev) => ({ ...prev, trial_ends_at: event.target.value }))
                }
                className="apple-input w-full"
              />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-slate-600">Periodo inicio</span>
              <input
                type="date"
                value={subscriptionForm.current_period_start}
                onChange={(event) =>
                  onSubscriptionFormChange((prev) => ({
                    ...prev,
                    current_period_start: event.target.value,
                  }))
                }
                className="apple-input w-full"
              />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-slate-600">Periodo fim</span>
              <input
                type="date"
                value={subscriptionForm.current_period_end}
                onChange={(event) =>
                  onSubscriptionFormChange((prev) => ({
                    ...prev,
                    current_period_end: event.target.value,
                  }))
                }
                className="apple-input w-full"
              />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-slate-600">Carencia de pagamento</span>
              <input
                type="date"
                value={subscriptionForm.payment_grace_until}
                onChange={(event) =>
                  onSubscriptionFormChange((prev) => ({
                    ...prev,
                    payment_grace_until: event.target.value,
                  }))
                }
                className="apple-input w-full"
              />
            </label>
          </div>

          <div className="grid md:grid-cols-[1fr_auto] gap-4 items-end">
            <label className="text-sm space-y-1">
              <span className="text-slate-600">Proxima cobranca</span>
              <input
                type="date"
                value={subscriptionForm.next_charge_at}
                onChange={(event) =>
                  onSubscriptionFormChange((prev) => ({
                    ...prev,
                    next_charge_at: event.target.value,
                  }))
                }
                className="apple-input w-full"
              />
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onSyncAsaasSubscription}
                disabled={syncingAsaas}
                className="border border-petroleum/30 text-petroleum px-4 py-3 rounded-xl font-semibold disabled:opacity-60"
              >
                {syncingAsaas ? "Sincronizando..." : "Sincronizar Asaas"}
              </button>
              <button
                type="submit"
                disabled={savingSubscription}
                className="bg-petroleum text-white px-5 py-3 rounded-xl font-semibold disabled:opacity-60 flex items-center gap-2"
              >
                <Save size={16} /> {savingSubscription ? "Salvando..." : "Salvar assinatura"}
              </button>
            </div>
          </div>

          <label className="text-sm space-y-1 block">
            <span className="text-slate-600">Motivo de suspensao</span>
            <textarea
              value={subscriptionForm.suspended_reason}
              onChange={(event) =>
                onSubscriptionFormChange((prev) => ({
                  ...prev,
                  suspended_reason: event.target.value,
                }))
              }
              rows={3}
              className="apple-input w-full resize-y"
            />
          </label>
        </form>

        <div className="border-t border-[#3A3A3C]/10 pt-5">
          <div className="flex items-center gap-2 text-petroleum font-bold uppercase text-xs tracking-wider mb-3">
            <ShieldCheck size={16} /> Flags de recurso
          </div>

          {loadingFeatures ? (
            <div className="text-sm text-slate-500 flex items-center gap-2">
              <Loader2 size={16} className="animate-spin" /> Carregando flags...
            </div>
          ) : features.length === 0 ? (
            <div className="text-sm text-slate-500">Nenhuma flag cadastrada para esta clinica.</div>
          ) : (
            <div className="space-y-2">
              {features.map((feature) => (
                <label
                  key={feature.feature_key}
                  className="flex items-center justify-between gap-3 border border-slate-200 rounded-xl px-3 py-2"
                >
                  <div>
                    <p className="font-semibold text-sm text-[#1A1A1A]">
                      {featureLabels[feature.feature_key] || feature.feature_key}
                    </p>
                    <p className="text-xs text-slate-500">{feature.feature_key}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-semibold ${feature.enabled ? "text-success" : "text-slate-500"}`}>
                      {feature.enabled ? "Ativo" : "Inativo"}
                    </span>
                    <button
                      type="button"
                      disabled={savingFeatureKey === feature.feature_key}
                      onClick={() => onToggleFeature(feature.feature_key, !feature.enabled)}
                      className={`w-11 h-6 rounded-full transition relative ${
                        feature.enabled ? "bg-success/80" : "bg-slate-300"
                      } ${savingFeatureKey === feature.feature_key ? "opacity-60" : ""}`}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                          feature.enabled ? "left-5" : "left-0.5"
                        }`}
                      />
                    </button>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
      </article>

      <aside className="space-y-6">
        <div className="glass-panel p-5 space-y-3">
          <div className="flex items-center gap-2 text-petroleum font-bold uppercase text-xs tracking-wider">
            <History size={16} /> Auditoria recente
          </div>

          <div className="space-y-2 max-h-[380px] overflow-auto pr-1">
            {auditLogs.length === 0 ? (
              <p className="text-sm text-slate-500">Sem eventos de auditoria.</p>
            ) : (
              auditLogs.map((log) => (
                <div key={log.id} className="border border-slate-200 rounded-xl p-3 text-sm">
                  <p className="font-semibold text-[#1A1A1A]">{log.action}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {toLocalDateTime(log.created_at)} | {log.actor_type}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 break-all">
                    alvo: {log.target_type} {log.target_id || "-"}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="glass-panel p-5 space-y-3">
          <div className="flex items-center gap-2 text-petroleum font-bold uppercase text-xs tracking-wider">
            <BookOpenText size={16} /> Ajuda de configuracao
          </div>
          <div className="space-y-3 text-sm text-slate-700">
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="font-semibold text-[#1A1A1A]">Dados da empresa e responsavel</p>
              <p className="text-slate-600 mt-1">
                Nome da empresa/clinica + email do responsavel. Se o email nao existir no Auth, o sistema cria
                automaticamente e retorna senha temporaria.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="font-semibold text-[#1A1A1A]">Asaas (quando usar cobranca automatica)</p>
              <p className="text-slate-600 mt-1">
                Pegue no Asaas os campos `customer id` e `subscription id` em Clientes e Assinaturas. Depois salve em
                "Assinatura e bloqueio".
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="font-semibold text-[#1A1A1A]">Evolution API / Mensageria</p>
              <p className="text-slate-600 mt-1">
                Necessario `api_base_url`, `instance_name`, `api_token` e `webhook_secret` da instancia Evolution para
                habilitar inbox e automacoes por labels.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="font-semibold text-[#1A1A1A]">Dominios e auth</p>
              <p className="text-slate-600 mt-1">
                Confirme DNS e SSL do dominio cliente e mantenha o dominio de superadmin exclusivo da plataforma.
              </p>
            </div>
          </div>
        </div>

        <div className="glass-panel p-5 space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-petroleum">Checklist proximo modulo</p>
          <ul className="text-sm text-slate-600 space-y-2 list-disc pl-5">
            <li>Asaas multi-tenant: sincronizar status por webhook.</li>
            <li>Evolution + inbox: threads, mensagens e atribuicoes.</li>
            <li>Kanban CRM: pipeline customizavel drag-and-drop.</li>
            <li>Automacoes por labels e regras de funil.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
