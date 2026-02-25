
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Session } from "@supabase/supabase-js";
import {
  AlertTriangle,
  Building2,
  History,
  Loader2,
  LogOut,
  RefreshCcw,
  Save,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Auth } from "./Auth";
import { Brand } from "./Brand";
import { Toast } from "./Toast";
import { AUTH_EXPIRED_EVENT, ApiError, apiRequest } from "../lib/api";
import { supabase } from "../lib/supabaseClient";

type TenantStatus = "trialing" | "active" | "past_due" | "suspended" | "cancelled";
type BillingProvider = "manual" | "asaas";

type SuperadminMe = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  active: boolean;
  allowed_hosts: string[];
};

type OverviewPayload = {
  totals: {
    clinics_total: number;
    active: number;
    trialing: number;
    past_due: number;
    suspended: number;
    cancelled: number;
    blocked: number;
    members_total: number;
  };
  recent_clinics: Array<{
    id: string;
    name: string;
    created_at: string;
    status: TenantStatus;
  }>;
};

type ClinicItem = {
  id: string;
  name: string;
  created_at: string;
  owner_user_id: string;
  owner_email: string | null;
  owner_full_name: string | null;
  subscription: {
    clinic_id: string;
    plan_code: string | null;
    status: TenantStatus;
    billing_provider: BillingProvider;
    asaas_customer_id: string | null;
    asaas_subscription_id: string | null;
    trial_ends_at: string | null;
    current_period_start: string | null;
    current_period_end: string | null;
    payment_grace_until: string | null;
    next_charge_at: string | null;
    blocked_at: string | null;
    suspended_reason: string | null;
    updated_at: string | null;
  };
  members: {
    active_members: number;
    roles: {
      admin: number;
      professional: number;
      secretary: number;
    };
  };
  features: {
    enabled_count: number;
    total_count: number;
  };
};

type ClinicsPayload = {
  clinics: ClinicItem[];
};

type FeatureFlag = {
  clinic_id: string;
  feature_key: string;
  enabled: boolean;
  config: Record<string, unknown>;
  updated_at: string | null;
};

type FeaturePayload = {
  features: FeatureFlag[];
};

type AuditLog = {
  id: number;
  actor_user_id: string | null;
  actor_type: "superadmin" | "system";
  action: string;
  target_type: string;
  target_id: string | null;
  clinic_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type AuditPayload = {
  logs: AuditLog[];
};

type SubscriptionFormState = {
  plan_code: string;
  status: TenantStatus;
  billing_provider: BillingProvider;
  asaas_customer_id: string;
  asaas_subscription_id: string;
  trial_ends_at: string;
  current_period_start: string;
  current_period_end: string;
  payment_grace_until: string;
  next_charge_at: string;
  suspended_reason: string;
};

const statusLabels: Record<TenantStatus, string> = {
  trialing: "Teste",
  active: "Ativa",
  past_due: "Em atraso",
  suspended: "Suspensa",
  cancelled: "Cancelada",
};

const featureLabels: Record<string, string> = {
  "billing.asaas": "Asaas habilitado",
  "messaging.evolution": "Evolution API",
  "messaging.inbox": "Caixa de mensagens",
  "crm.kanban": "Kanban CRM",
  "crm.pipeline_automation": "Automacoes por labels",
  "ai.assistant": "Assistente IA",
};

function toDateInput(value: string | null | undefined) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function toLocalDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("pt-BR");
}

function emptySubscriptionForm(): SubscriptionFormState {
  return {
    plan_code: "starter",
    status: "active",
    billing_provider: "manual",
    asaas_customer_id: "",
    asaas_subscription_id: "",
    trial_ends_at: "",
    current_period_start: "",
    current_period_end: "",
    payment_grace_until: "",
    next_charge_at: "",
    suspended_reason: "",
  };
}

export const SuperAdminApp = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [me, setMe] = useState<SuperadminMe | null>(null);
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [clinics, setClinics] = useState<ClinicItem[]>([]);
  const [features, setFeatures] = useState<FeatureFlag[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [query, setQuery] = useState("");
  const [selectedClinicId, setSelectedClinicId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingFeatures, setLoadingFeatures] = useState(false);
  const [savingSubscription, setSavingSubscription] = useState(false);
  const [syncingAsaas, setSyncingAsaas] = useState(false);
  const [savingFeatureKey, setSavingFeatureKey] = useState<string | null>(null);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(
    null
  );
  const [subscriptionForm, setSubscriptionForm] = useState<SubscriptionFormState>(
    emptySubscriptionForm()
  );
  const authExpireInFlightRef = useRef(false);

  const accessToken = session?.access_token || "";

  const selectedClinic = useMemo(
    () => clinics.find((clinic) => clinic.id === selectedClinicId) || null,
    [clinics, selectedClinicId]
  );
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => {
      setToast(null);
    }, 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const onAuthExpired = async () => {
      if (authExpireInFlightRef.current) return;
      authExpireInFlightRef.current = true;
      try {
        await supabase.auth.signOut();
        setSession(null);
        setMe(null);
        setOverview(null);
        setClinics([]);
        setFeatures([]);
        setAuditLogs([]);
        setSelectedClinicId(null);
        setPortalError("Sessao expirada. Faca login novamente.");
      } finally {
        authExpireInFlightRef.current = false;
      }
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthExpired as EventListener);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthExpired as EventListener);
    };
  }, []);

  const loadOverview = async (token = accessToken) => {
    const data = await apiRequest<OverviewPayload>("/api/superadmin/dashboard/overview", token);
    setOverview(data);
  };

  const loadClinics = async (token = accessToken) => {
    const path =
      query.trim().length > 0
        ? `/api/superadmin/clinics?q=${encodeURIComponent(query.trim())}`
        : "/api/superadmin/clinics";
    const data = await apiRequest<ClinicsPayload>(path, token);
    const clinicList = data.clinics || [];
    setClinics(clinicList);

    setSelectedClinicId((current) => {
      if (current && clinicList.some((item) => item.id === current)) {
        return current;
      }
      return clinicList[0]?.id || null;
    });
  };

  const loadFeatures = async (token = accessToken, clinicId = selectedClinicId || "") => {
    if (!clinicId) return;
    setLoadingFeatures(true);
    try {
      const data = await apiRequest<FeaturePayload>(`/api/superadmin/clinics/${clinicId}/features`, token);
      setFeatures(data.features || []);
    } catch (error) {
      console.error("Failed to load features", error);
      setToast({ type: "error", message: "Falha ao carregar flags da clinica." });
      setFeatures([]);
    } finally {
      setLoadingFeatures(false);
    }
  };

  const loadAudit = async (token = accessToken) => {
    const data = await apiRequest<AuditPayload>("/api/superadmin/audit?limit=80", token);
    setAuditLogs(data.logs || []);
  };

  useEffect(() => {
    if (!session?.access_token) {
      setMe(null);
      setOverview(null);
      setClinics([]);
      setFeatures([]);
      setAuditLogs([]);
      setSelectedClinicId(null);
      return;
    }

    const bootstrap = async () => {
      setLoading(true);
      setPortalError(null);
      try {
        const meData = await apiRequest<SuperadminMe>("/api/superadmin/me", session.access_token);
        setMe(meData);
        await Promise.all([
          loadOverview(session.access_token),
          loadClinics(session.access_token),
          loadAudit(session.access_token),
        ]);
      } catch (error) {
        console.error("Failed to bootstrap superadmin", error);
        if (error instanceof ApiError) {
          setPortalError(error.message || "Falha ao carregar portal de superadmin.");
        } else {
          setPortalError("Falha ao carregar portal de superadmin.");
        }
      } finally {
        setLoading(false);
      }
    };

    bootstrap();
  }, [session?.access_token]);

  useEffect(() => {
    if (!selectedClinic) {
      setSubscriptionForm(emptySubscriptionForm());
      return;
    }
    setSubscriptionForm({
      plan_code: selectedClinic.subscription.plan_code || "starter",
      status: selectedClinic.subscription.status,
      billing_provider: selectedClinic.subscription.billing_provider,
      asaas_customer_id: selectedClinic.subscription.asaas_customer_id || "",
      asaas_subscription_id: selectedClinic.subscription.asaas_subscription_id || "",
      trial_ends_at: toDateInput(selectedClinic.subscription.trial_ends_at),
      current_period_start: toDateInput(selectedClinic.subscription.current_period_start),
      current_period_end: toDateInput(selectedClinic.subscription.current_period_end),
      payment_grace_until: toDateInput(selectedClinic.subscription.payment_grace_until),
      next_charge_at: toDateInput(selectedClinic.subscription.next_charge_at),
      suspended_reason: selectedClinic.subscription.suspended_reason || "",
    });
  }, [selectedClinic]);

  useEffect(() => {
    if (!selectedClinicId || !accessToken) {
      setFeatures([]);
      return;
    }
    loadFeatures(accessToken, selectedClinicId);
  }, [selectedClinicId, accessToken]);

  const handleRefreshAll = async () => {
    if (!accessToken) return;
    setLoading(true);
    setPortalError(null);
    try {
      await Promise.all([loadOverview(), loadClinics(), loadAudit()]);
      if (selectedClinicId) {
        await loadFeatures(accessToken, selectedClinicId);
      }
      setToast({ type: "success", message: "Dados atualizados." });
    } catch (error) {
      console.error("Failed to refresh portal", error);
      setToast({ type: "error", message: "Falha ao atualizar dados do portal." });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSubscription = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedClinicId || !accessToken) return;

    setSavingSubscription(true);
    try {
      await apiRequest<{ subscription: ClinicItem["subscription"] }>(
        `/api/superadmin/clinics/${selectedClinicId}/subscription`,
        accessToken,
        {
          method: "PATCH",
          body: JSON.stringify({
            plan_code: subscriptionForm.plan_code.trim() || "starter",
            status: subscriptionForm.status,
            billing_provider: subscriptionForm.billing_provider,
            asaas_customer_id: subscriptionForm.asaas_customer_id.trim() || null,
            asaas_subscription_id: subscriptionForm.asaas_subscription_id.trim() || null,
            trial_ends_at: subscriptionForm.trial_ends_at || null,
            current_period_start: subscriptionForm.current_period_start || null,
            current_period_end: subscriptionForm.current_period_end || null,
            payment_grace_until: subscriptionForm.payment_grace_until || null,
            next_charge_at: subscriptionForm.next_charge_at || null,
            suspended_reason: subscriptionForm.suspended_reason.trim() || null,
          }),
        }
      );

      await Promise.all([loadOverview(), loadClinics(), loadAudit()]);
      setToast({ type: "success", message: "Assinatura atualizada." });
    } catch (error) {
      console.error("Failed to update subscription", error);
      const message = error instanceof ApiError ? error.message : "Falha ao atualizar assinatura.";
      setToast({ type: "error", message });
    } finally {
      setSavingSubscription(false);
    }
  };

  const handleToggleFeature = async (featureKey: string, nextEnabled: boolean) => {
    if (!selectedClinicId || !accessToken) return;

    const current = features.find((item) => item.feature_key === featureKey);
    setSavingFeatureKey(featureKey);
    try {
      await apiRequest<{ feature: FeatureFlag }>(
        `/api/superadmin/clinics/${selectedClinicId}/features/${encodeURIComponent(featureKey)}`,
        accessToken,
        {
          method: "PUT",
          body: JSON.stringify({
            enabled: nextEnabled,
            config: current?.config || {},
          }),
        }
      );

      await Promise.all([loadFeatures(), loadClinics(), loadAudit()]);
      setToast({ type: "success", message: `Flag ${featureKey} atualizada.` });
    } catch (error) {
      console.error("Failed to update feature", error);
      const message = error instanceof ApiError ? error.message : "Falha ao atualizar flag.";
      setToast({ type: "error", message });
    } finally {
      setSavingFeatureKey(null);
    }
  };

  const handleSyncAsaasSubscription = async () => {
    if (!selectedClinicId || !accessToken) return;

    setSyncingAsaas(true);
    try {
      await apiRequest(
        `/api/superadmin/clinics/${selectedClinicId}/asaas/sync-subscription`,
        accessToken,
        { method: "POST" }
      );
      await Promise.all([loadOverview(), loadClinics(), loadAudit()]);
      setToast({ type: "success", message: "Assinatura sincronizada com Asaas." });
    } catch (error) {
      console.error("Failed to sync Asaas subscription", error);
      const message =
        error instanceof ApiError ? error.message : "Falha ao sincronizar assinatura no Asaas.";
      setToast({ type: "error", message });
    } finally {
      setSyncingAsaas(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setMe(null);
    setOverview(null);
    setClinics([]);
    setFeatures([]);
    setAuditLogs([]);
    setSelectedClinicId(null);
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#F7F8FA] flex items-center justify-center text-slate-500">
        Carregando portal...
      </div>
    );
  }

  if (!session) {
    return <Auth initialMode="signin" />;
  }

  if (loading && !me) {
    return (
      <div className="min-h-screen bg-[#F7F8FA] flex items-center justify-center text-slate-500 gap-2">
        <Loader2 size={18} className="animate-spin" /> Carregando superadmin...
      </div>
    );
  }

  if (portalError && !me) {
    return (
      <div className="min-h-screen bg-[#F7F8FA] flex items-center justify-center p-6">
        <div className="glass-panel p-8 max-w-2xl space-y-4">
          <div className="flex items-center gap-2 text-error font-semibold">
            <AlertTriangle size={18} /> Acesso nao autorizado
          </div>
          <p className="text-slate-700">{portalError}</p>
          <p className="text-sm text-slate-500">
            Este dominio e exclusivo para superadmin. Verifique se o usuario esta cadastrado em
            <code> platform_superadmins</code>.
          </p>
          <button
            onClick={handleSignOut}
            className="bg-petroleum text-white px-4 py-2.5 rounded-xl font-semibold"
          >
            Sair
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F8FA]">
      {toast && <Toast type={toast.type} message={toast.message} />}

      <header className="sticky top-0 z-20 border-b border-[#3A3A3C]/10 bg-white/80 backdrop-blur-lg">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Brand />
            <div className="px-3 py-1.5 rounded-lg bg-petroleum/10 text-petroleum text-xs font-bold uppercase tracking-wider">
              Superadmin
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleRefreshAll}
              disabled={loading}
              className="border border-petroleum/25 text-petroleum px-4 py-2 rounded-xl font-semibold text-sm disabled:opacity-60 flex items-center gap-2"
            >
              <RefreshCcw size={16} className={loading ? "animate-spin" : ""} /> Atualizar
            </button>
            <div className="text-right">
              <p className="text-sm font-semibold text-[#1A1A1A]">{me?.full_name || "Superadmin"}</p>
              <p className="text-xs text-slate-500">{me?.email || "sem-email"}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="border border-slate-300 text-slate-600 px-3 py-2 rounded-xl text-sm flex items-center gap-2"
            >
              <LogOut size={15} /> Sair
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto p-6 grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-6">
        <section className="glass-panel p-5 h-fit space-y-4">
          <div className="flex items-center gap-2 text-petroleum font-bold uppercase text-xs tracking-wider">
            <Building2 size={16} /> Clinicas
          </div>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  loadClinics();
                }
              }}
              placeholder="Buscar por clinica ou responsavel"
              className="apple-input w-full pl-10"
            />
          </div>

          <button
            onClick={() => loadClinics()}
            className="w-full border border-petroleum/30 text-petroleum px-4 py-2.5 rounded-xl font-semibold text-sm"
          >
            Aplicar filtro
          </button>

          <div className="space-y-2 max-h-[70vh] overflow-auto pr-1">
            {clinics.length === 0 ? (
              <div className="text-sm text-slate-500 py-6 text-center">Nenhuma clinica encontrada.</div>
            ) : (
              clinics.map((clinic) => (
                <button
                  key={clinic.id}
                  onClick={() => setSelectedClinicId(clinic.id)}
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
        </section>

        <section className="space-y-6">
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

          {!selectedClinic ? (
            <div className="glass-panel p-8 text-slate-500">Selecione uma clinica para iniciar a gestao.</div>
          ) : (
            <div className="grid grid-cols-1 2xl:grid-cols-[1.15fr_0.85fr] gap-6">
              <article className="glass-panel p-6 space-y-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-bold text-[#1A1A1A]">{selectedClinic.name}</h2>
                    <p className="text-sm text-slate-500 mt-1">
                      Criada em {toLocalDateTime(selectedClinic.created_at)} • Owner: {selectedClinic.owner_email || selectedClinic.owner_user_id}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-semibold text-[#1A1A1A]">Membros ativos: {selectedClinic.members.active_members}</p>
                    <p className="text-slate-500">
                      Admin {selectedClinic.members.roles.admin} • Profissionais {selectedClinic.members.roles.professional} • Secretaria {selectedClinic.members.roles.secretary}
                    </p>
                  </div>
                </div>

                <form onSubmit={handleSaveSubscription} className="space-y-4">
                  <div className="flex items-center gap-2 text-petroleum font-bold uppercase text-xs tracking-wider">
                    <ShieldCheck size={16} /> Assinatura e bloqueio
                  </div>

                  <div className="grid md:grid-cols-3 gap-4">
                    <label className="text-sm space-y-1">
                      <span className="text-slate-600">Plano</span>
                      <input
                        value={subscriptionForm.plan_code}
                        onChange={(event) =>
                          setSubscriptionForm((prev) => ({ ...prev, plan_code: event.target.value }))
                        }
                        className="apple-input w-full"
                      />
                    </label>

                    <label className="text-sm space-y-1">
                      <span className="text-slate-600">Status</span>
                      <select
                        value={subscriptionForm.status}
                        onChange={(event) =>
                          setSubscriptionForm((prev) => ({
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
                          setSubscriptionForm((prev) => ({
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
                          setSubscriptionForm((prev) => ({
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
                          setSubscriptionForm((prev) => ({
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
                          setSubscriptionForm((prev) => ({ ...prev, trial_ends_at: event.target.value }))
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
                          setSubscriptionForm((prev) => ({
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
                          setSubscriptionForm((prev) => ({
                            ...prev,
                            current_period_end: event.target.value,
                          }))
                        }
                        className="apple-input w-full"
                      />
                    </label>
                    <label className="text-sm space-y-1">
                      <span className="text-slate-600">Graca pagamento</span>
                      <input
                        type="date"
                        value={subscriptionForm.payment_grace_until}
                        onChange={(event) =>
                          setSubscriptionForm((prev) => ({
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
                          setSubscriptionForm((prev) => ({
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
                        onClick={handleSyncAsaasSubscription}
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
                        setSubscriptionForm((prev) => ({
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
                            <span
                              className={`text-xs font-semibold ${
                                feature.enabled ? "text-success" : "text-slate-500"
                              }`}
                            >
                              {feature.enabled ? "Ativo" : "Inativo"}
                            </span>
                            <button
                              type="button"
                              disabled={savingFeatureKey === feature.feature_key}
                              onClick={() => handleToggleFeature(feature.feature_key, !feature.enabled)}
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

                  <div className="space-y-2 max-h-[410px] overflow-auto pr-1">
                    {auditLogs.length === 0 ? (
                      <p className="text-sm text-slate-500">Sem eventos de auditoria.</p>
                    ) : (
                      auditLogs.map((log) => (
                        <div key={log.id} className="border border-slate-200 rounded-xl p-3 text-sm">
                          <p className="font-semibold text-[#1A1A1A]">{log.action}</p>
                          <p className="text-xs text-slate-500 mt-1">
                            {toLocalDateTime(log.created_at)} • {log.actor_type}
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
          )}
        </section>
      </main>
    </div>
  );
};
