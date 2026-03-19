import React, { useEffect, useMemo, useRef, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { AlertTriangle, Loader2, LogOut, RefreshCcw } from "lucide-react";
import { Auth } from "./Auth";
import { Brand } from "./Brand";
import { Toast } from "./Toast";
import { ClinicListPanel } from "./superadmin/ClinicListPanel";
import { ClinicWorkspace } from "./superadmin/ClinicWorkspace";
import { CreateClinicPanel } from "./superadmin/CreateClinicPanel";
import { OverviewCards } from "./superadmin/OverviewCards";
import {
  ClinicItem,
  ClinicsPayload,
  CreateClinicFlash,
  CreateClinicFormState,
  CreateClinicResponse,
  FeatureFlag,
  FeaturePayload,
  OverviewPayload,
  SuperadminMe,
  SubscriptionFormState,
  AuditPayload,
  defaultCreateClinicFeatures,
  emptyCreateClinicForm,
  emptySubscriptionForm,
  toDateInput,
} from "./superadmin/types";
import { AUTH_EXPIRED_EVENT, ApiError, apiRequest } from "../lib/api";
import { supabase } from "../lib/supabaseClient";

export const SuperAdminApp = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [me, setMe] = useState<SuperadminMe | null>(null);
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [clinics, setClinics] = useState<ClinicItem[]>([]);
  const [features, setFeatures] = useState<FeatureFlag[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditPayload["logs"]>([]);
  const [query, setQuery] = useState("");
  const [selectedClinicId, setSelectedClinicId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingFeatures, setLoadingFeatures] = useState(false);
  const [savingSubscription, setSavingSubscription] = useState(false);
  const [syncingAsaas, setSyncingAsaas] = useState(false);
  const [creatingClinic, setCreatingClinic] = useState(false);
  const [savingFeatureKey, setSavingFeatureKey] = useState<string | null>(null);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [createClinicFlash, setCreateClinicFlash] = useState<CreateClinicFlash | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(
    null
  );
  const [subscriptionForm, setSubscriptionForm] = useState<SubscriptionFormState>(
    emptySubscriptionForm()
  );
  const [createClinicForm, setCreateClinicForm] = useState<CreateClinicFormState>(
    emptyCreateClinicForm()
  );
  const [createClinicFeatures, setCreateClinicFeatures] = useState<string[]>([
    ...defaultCreateClinicFeatures,
  ]);
  const authExpireInFlightRef = useRef(false);

  const accessToken = session?.access_token || "";

  const selectedClinic = useMemo(
    () => clinics.find((clinic) => clinic.id === selectedClinicId) || null,
    [clinics, selectedClinicId]
  );

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getSession().then(({ data }) => {
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

  const loadClinics = async (token = accessToken, searchTerm = query) => {
    const path =
      searchTerm.trim().length > 0
        ? `/api/superadmin/clinics?q=${encodeURIComponent(searchTerm.trim())}`
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
      const data = await apiRequest<FeaturePayload>(
        `/api/superadmin/clinics/${clinicId}/features`,
        token
      );
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

    void bootstrap();
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
    void loadFeatures(accessToken, selectedClinicId);
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

  const toggleCreateClinicFeature = (featureKey: string) => {
    setCreateClinicFeatures((current) => {
      if (current.includes(featureKey)) {
        return current.filter((item) => item !== featureKey);
      }
      return [...current, featureKey];
    });
  };

  const handleSelectAllCreateClinicFeatures = () => {
    setCreateClinicFeatures([...defaultCreateClinicFeatures]);
  };

  const handleClearCreateClinicFeatures = () => {
    setCreateClinicFeatures([]);
  };

  const handleCreateClinic = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;

    const name = createClinicForm.name.trim();
    const ownerEmail = createClinicForm.owner_email.trim();
    if (!name) {
      setToast({ type: "error", message: "Informe o nome da empresa/clinica." });
      return;
    }
    if (!ownerEmail) {
      setToast({ type: "error", message: "Informe o email do responsavel." });
      return;
    }

    setCreatingClinic(true);
    try {
      const response = await apiRequest<CreateClinicResponse>("/api/superadmin/clinics", accessToken, {
        method: "POST",
        body: JSON.stringify({
          name,
          owner_email: ownerEmail,
          owner_full_name: createClinicForm.owner_full_name.trim() || null,
          owner_password: createClinicForm.owner_password.trim() || null,
          create_owner_if_missing: true,
          plan_code: createClinicForm.plan_code.trim() || "starter",
          status: createClinicForm.status,
          billing_provider: createClinicForm.billing_provider,
          enabled_features: createClinicFeatures,
        }),
      });

      setCreateClinicFlash({
        clinic_name: response.clinic.name,
        owner_email: response.owner.email,
        owner_created: response.owner.created,
        temporary_password: response.owner.temporary_password,
      });
      setCreateClinicForm(emptyCreateClinicForm());
      setCreateClinicFeatures([...defaultCreateClinicFeatures]);
      setQuery("");

      await Promise.all([loadOverview(), loadClinics(accessToken, ""), loadAudit()]);
      setSelectedClinicId(response.clinic.id);
      await loadFeatures(accessToken, response.clinic.id);
      setToast({ type: "success", message: "Empresa cadastrada com sucesso." });
    } catch (error) {
      console.error("Failed to create clinic", error);
      const message = error instanceof ApiError ? error.message : "Falha ao cadastrar empresa.";
      setToast({ type: "error", message });
    } finally {
      setCreatingClinic(false);
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

      <main className="max-w-[1600px] mx-auto p-6 space-y-6">
        {portalError && me ? (
          <div className="glass-panel p-4 border border-warning/30 bg-warning/10">
            <div className="flex items-center gap-2 text-[#8a5d00] font-semibold">
              <AlertTriangle size={16} /> {portalError}
            </div>
          </div>
        ) : null}

        <OverviewCards overview={overview} />

        <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-6">
          <section className="space-y-6">
            <CreateClinicPanel
              form={createClinicForm}
              selectedFeatures={createClinicFeatures}
              creatingClinic={creatingClinic}
              flash={createClinicFlash}
              onFormChange={setCreateClinicForm}
              onToggleFeature={toggleCreateClinicFeature}
              onSelectAllFeatures={handleSelectAllCreateClinicFeatures}
              onClearFeatures={handleClearCreateClinicFeatures}
              onSubmit={handleCreateClinic}
            />

            <ClinicListPanel
              clinics={clinics}
              query={query}
              selectedClinicId={selectedClinicId}
              onQueryChange={setQuery}
              onApplyFilter={() => {
                void loadClinics();
              }}
              onSelectClinic={setSelectedClinicId}
            />
          </section>

          <section className="space-y-6">
            <ClinicWorkspace
              selectedClinic={selectedClinic}
              subscriptionForm={subscriptionForm}
              features={features}
              auditLogs={auditLogs}
              loadingFeatures={loadingFeatures}
              savingSubscription={savingSubscription}
              syncingAsaas={syncingAsaas}
              savingFeatureKey={savingFeatureKey}
              onSubscriptionFormChange={setSubscriptionForm}
              onSaveSubscription={handleSaveSubscription}
              onSyncAsaasSubscription={handleSyncAsaasSubscription}
              onToggleFeature={handleToggleFeature}
            />
          </section>
        </div>
      </main>
    </div>
  );
};
