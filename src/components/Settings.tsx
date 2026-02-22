import React, { useEffect, useState } from "react";
import {
  User,
  SlidersHorizontal,
  Save,
  Download,
  LogOut,
  CheckCircle2,
  AlertCircle,
  Link2,
  RefreshCcw,
  Unplug,
  ShieldAlert,
  Users,
  Wallet,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { ApiError, apiRequest } from "../lib/api";
import { formatLocalDateInput } from "../lib/date";
import {
  NotePreferences,
  defaultNotePreferences,
  readNotePreferences,
  saveNotePreferences,
} from "../lib/preferences";
import { ClinicMember } from "../lib/types";
import { Note } from "../lib/utils";

interface SettingsProps {
  accessToken: string;
  role: "admin" | "professional" | "secretary";
  userName: string;
  userEmail: string;
  onSignOut: () => Promise<void> | void;
  onSessionRefresh: () => Promise<void> | void;
  onNotesChanged: () => Promise<void> | void;
}

type Feedback = { type: "success" | "error"; message: string } | null;
type ReminderPreset = "light" | "standard" | "intense";

type GoogleStatus = {
  configured: boolean;
  feature_enabled?: boolean;
  connected: boolean;
  connection?: {
    google_email?: string | null;
    expires_at?: string | null;
    updated_at?: string | null;
  } | null;
  watch?: {
    expiration_at?: string | null;
    active?: boolean;
  } | null;
};

type AsaasSettingsPayload = {
  configured: boolean;
  settings: {
    reminder_preset: ReminderPreset;
    reminder_channels: string[];
    reminder_timeline: Array<Record<string, unknown>>;
    default_due_days: number;
    late_fee_percent: number;
    interest_percent: number;
  };
};

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message || fallback;
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}

export const Settings = ({
  accessToken,
  role,
  userName,
  userEmail,
  onSignOut,
  onSessionRefresh,
}: SettingsProps) => {
  const [fullName, setFullName] = useState(userName || "");
  const [preferences, setPreferences] = useState<NotePreferences>(defaultNotePreferences);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const [members, setMembers] = useState<ClinicMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [invitingMember, setInvitingMember] = useState(false);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<"admin" | "professional" | "secretary">(
    "secretary"
  );

  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [disconnectingGoogle, setDisconnectingGoogle] = useState(false);
  const [resyncingGoogle, setResyncingGoogle] = useState(false);

  const [asaasConfigured, setAsaasConfigured] = useState(false);
  const [loadingAsaasSettings, setLoadingAsaasSettings] = useState(false);
  const [savingAsaasSettings, setSavingAsaasSettings] = useState(false);
  const [reminderPreset, setReminderPreset] = useState<ReminderPreset>("standard");
  const [reminderChannels, setReminderChannels] = useState<string[]>(["email", "sms"]);
  const [reminderTimelineText, setReminderTimelineText] = useState<string>("[]");
  const [defaultDueDays, setDefaultDueDays] = useState<number>(2);
  const [lateFeePercent, setLateFeePercent] = useState<number>(2);
  const [interestPercent, setInterestPercent] = useState<number>(1);

  const canAccessClinical = role !== "secretary";
  const canManageMembers = role === "admin";
  const canManageGoogle = role === "admin" || role === "professional";
  const canManageAsaas = role === "admin" || role === "professional";

  useEffect(() => {
    setFullName(userName || "");
  }, [userName]);

  useEffect(() => {
    setPreferences(readNotePreferences());
  }, []);

  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(() => setFeedback(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  useEffect(() => {
    if (!canManageMembers) return;
    fetchMembers();
  }, [canManageMembers, accessToken]);

  useEffect(() => {
    if (!canManageGoogle) return;
    fetchGoogleStatus();
  }, [canManageGoogle, accessToken]);

  useEffect(() => {
    if (!canManageAsaas) return;
    fetchAsaasSettings();
  }, [canManageAsaas, accessToken]);

  const fetchMembers = async () => {
    setLoadingMembers(true);
    try {
      const data = await apiRequest<ClinicMember[]>("/api/clinic/members", accessToken);
      setMembers(data || []);
    } catch (error) {
      console.error("Failed to load clinic members", error);
      setFeedback({ type: "error", message: "Falha ao carregar membros da clinica." });
    } finally {
      setLoadingMembers(false);
    }
  };

  const fetchGoogleStatus = async () => {
    setLoadingGoogle(true);
    try {
      const data = await apiRequest<GoogleStatus>("/api/integrations/google/status", accessToken);
      setGoogleStatus(data);
    } catch (error) {
      console.error("Failed to load google status", error);
      setGoogleStatus(null);
      setFeedback({
        type: "error",
        message: getErrorMessage(error, "Falha ao carregar status do Google Agenda."),
      });
    } finally {
      setLoadingGoogle(false);
    }
  };

  const fetchAsaasSettings = async () => {
    setLoadingAsaasSettings(true);
    try {
      const data = await apiRequest<AsaasSettingsPayload>(
        "/api/financial/asaas/settings",
        accessToken
      );
      setAsaasConfigured(Boolean(data?.configured));
      setReminderPreset(data?.settings?.reminder_preset || "standard");
      setReminderChannels(
        Array.isArray(data?.settings?.reminder_channels)
          ? data.settings.reminder_channels
          : ["email", "sms"]
      );
      setReminderTimelineText(
        JSON.stringify(
          Array.isArray(data?.settings?.reminder_timeline) ? data.settings.reminder_timeline : [],
          null,
          2
        )
      );
      setDefaultDueDays(Number(data?.settings?.default_due_days ?? 2));
      setLateFeePercent(Number(data?.settings?.late_fee_percent ?? 2));
      setInterestPercent(Number(data?.settings?.interest_percent ?? 1));
    } catch (error) {
      console.error("Failed to load Asaas settings", error);
      setFeedback({
        type: "error",
        message: getErrorMessage(error, "Falha ao carregar configuracoes do Asaas."),
      });
    } finally {
      setLoadingAsaasSettings(false);
    }
  };

  const handleGoogleConnect = async () => {
    setConnectingGoogle(true);
    try {
      const data = await apiRequest<{ url: string }>("/api/integrations/google/connect", accessToken, {
        method: "POST",
      });

      if (!data?.url) {
        throw new Error("URL de conexao nao retornada.");
      }

      const popup = window.open(data.url, "smartpsi_google_oauth", "width=640,height=760");
      if (!popup) {
        window.location.assign(data.url);
        return;
      }

      const startedAt = Date.now();
      const poll = window.setInterval(async () => {
        const timedOut = Date.now() - startedAt > 2 * 60 * 1000;
        if (popup.closed || timedOut) {
          window.clearInterval(poll);
          setConnectingGoogle(false);
          await fetchGoogleStatus();
          if (!popup.closed) popup.close();
        }
      }, 1800);
    } catch (error) {
      console.error("Failed to connect Google", error);
      setFeedback({
        type: "error",
        message: getErrorMessage(error, "Falha ao iniciar conexao com Google."),
      });
      setConnectingGoogle(false);
    }
  };

  const handleGoogleDisconnect = async () => {
    setDisconnectingGoogle(true);
    try {
      await apiRequest<{ success: boolean }>("/api/integrations/google/disconnect", accessToken, {
        method: "POST",
      });
      await fetchGoogleStatus();
      setFeedback({ type: "success", message: "Google Agenda desconectado." });
    } catch (error) {
      console.error("Failed to disconnect Google", error);
      setFeedback({
        type: "error",
        message: getErrorMessage(error, "Falha ao desconectar Google Agenda."),
      });
    } finally {
      setDisconnectingGoogle(false);
    }
  };

  const handleGoogleResync = async () => {
    setResyncingGoogle(true);
    try {
      await apiRequest<{ success: boolean }>("/api/integrations/google/resync", accessToken, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await fetchGoogleStatus();
      setFeedback({ type: "success", message: "Sincronizacao Google executada." });
    } catch (error) {
      console.error("Failed to resync Google", error);
      setFeedback({
        type: "error",
        message: getErrorMessage(error, "Falha ao sincronizar Google Agenda."),
      });
    } finally {
      setResyncingGoogle(false);
    }
  };

  const handleSaveAsaasSettings = async (e: React.FormEvent) => {
    e.preventDefault();

    let parsedTimeline: Array<Record<string, unknown>> = [];
    try {
      const raw = JSON.parse(reminderTimelineText || "[]");
      if (!Array.isArray(raw)) {
        throw new Error("Timeline deve ser um array JSON.");
      }
      parsedTimeline = raw;
    } catch {
      setFeedback({ type: "error", message: "Timeline de lembretes invalida. Use JSON valido." });
      return;
    }

    setSavingAsaasSettings(true);
    try {
      await apiRequest<AsaasSettingsPayload>("/api/financial/asaas/settings", accessToken, {
        method: "PATCH",
        body: JSON.stringify({
          reminder_preset: reminderPreset,
          reminder_channels: reminderChannels,
          reminder_timeline: parsedTimeline,
          default_due_days: Number(defaultDueDays),
          late_fee_percent: Number(lateFeePercent),
          interest_percent: Number(interestPercent),
        }),
      });
      await fetchAsaasSettings();
      setFeedback({ type: "success", message: "Configuracoes Asaas atualizadas." });
    } catch (error) {
      console.error("Failed to save Asaas settings", error);
      setFeedback({
        type: "error",
        message: getErrorMessage(error, "Falha ao salvar configuracoes Asaas."),
      });
    } finally {
      setSavingAsaasSettings(false);
    }
  };

  const toggleReminderChannel = (channel: string) => {
    setReminderChannels((prev) => {
      if (prev.includes(channel)) {
        return prev.filter((item) => item !== channel);
      }
      return [...prev, channel];
    });
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextName = fullName.trim();
    if (!nextName) {
      setFeedback({ type: "error", message: "Informe um nome valido." });
      return;
    }

    setIsSavingProfile(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: nextName },
      });
      if (error) throw error;

      await onSessionRefresh();
      setFeedback({ type: "success", message: "Perfil atualizado com sucesso." });
    } catch (error: unknown) {
      console.error("Failed to update profile", error);
      setFeedback({
        type: "error",
        message: getErrorMessage(error, "Nao foi possivel atualizar o perfil."),
      });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingPreferences(true);
    try {
      saveNotePreferences(preferences);
      setFeedback({ type: "success", message: "Preferencias salvas localmente." });
    } catch {
      setFeedback({ type: "error", message: "Falha ao salvar preferencias." });
    } finally {
      setIsSavingPreferences(false);
    }
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = memberEmail.trim();
    if (!email) {
      setFeedback({ type: "error", message: "Informe o e-mail do usuario." });
      return;
    }

    setInvitingMember(true);
    try {
      await apiRequest<{ success: boolean }>("/api/clinic/members", accessToken, {
        method: "POST",
        body: JSON.stringify({ email, role: memberRole }),
      });
      setMemberEmail("");
      await fetchMembers();
      setFeedback({ type: "success", message: "Membro adicionado na clinica." });
    } catch (error: unknown) {
      console.error("Failed to invite member", error);
      setFeedback({
        type: "error",
        message: getErrorMessage(error, "Nao foi possivel adicionar membro."),
      });
    } finally {
      setInvitingMember(false);
    }
  };

  const handleUpdateMember = async (
    memberId: number,
    nextRole: "admin" | "professional" | "secretary",
    nextActive: boolean
  ) => {
    try {
      await apiRequest<{ success: boolean }>(`/api/clinic/members/${memberId}`, accessToken, {
        method: "PATCH",
        body: JSON.stringify({ role: nextRole, active: nextActive }),
      });
      await fetchMembers();
      setFeedback({ type: "success", message: "Membro atualizado." });
    } catch (error: unknown) {
      console.error("Failed to update member", error);
      setFeedback({
        type: "error",
        message: getErrorMessage(error, "Falha ao atualizar membro."),
      });
    }
  };

  const handleRemoveMember = async (memberId: number) => {
    const confirmed = window.confirm("Remover este membro da clinica?");
    if (!confirmed) return;

    try {
      await apiRequest<{ success: boolean }>(`/api/clinic/members/${memberId}`, accessToken, {
        method: "DELETE",
      });
      await fetchMembers();
      setFeedback({ type: "success", message: "Membro removido." });
    } catch (error: unknown) {
      console.error("Failed to remove member", error);
      setFeedback({
        type: "error",
        message: getErrorMessage(error, "Falha ao remover membro."),
      });
    }
  };

  const handleExportNotes = async () => {
    setIsExporting(true);
    try {
      const notes = await apiRequest<Note[]>("/api/notes", accessToken);
      const payload = {
        exported_at: new Date().toISOString(),
        notes: notes || [],
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `smartpsi-notes-${formatLocalDateInput()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      setFeedback({ type: "success", message: "Exportacao concluida." });
    } catch (error) {
      console.error("Failed to export notes", error);
      setFeedback({ type: "error", message: "Nao foi possivel exportar as notas." });
    } finally {
      setIsExporting(false);
    }
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <div className="max-w-5xl space-y-8">
      {feedback && (
        <div
          className={`px-4 py-3 rounded-xl border flex items-start gap-2 ${
            feedback.type === "success"
              ? "bg-success/10 text-success border-success/20"
              : "bg-error/10 text-error border-error/20"
          }`}
        >
          {feedback.type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span className="text-sm font-medium">{feedback.message}</span>
        </div>
      )}

      <div>
        <h2 className="text-3xl font-bold tracking-tight">Configuracoes</h2>
        <p className="text-slate-500">
          Gerencie acesso da clinica, integracoes e parametros operacionais.
        </p>
      </div>

      <div className="glass-panel p-8 space-y-6">
        <div className="flex items-center gap-3">
          <User size={18} className="text-petroleum" />
          <h3 className="font-bold text-petroleum uppercase tracking-wider text-sm">
            Perfil profissional
          </h3>
        </div>

        <form onSubmit={handleSaveProfile} className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Nome completo
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="apple-input w-full"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
              E-mail
            </label>
            <input type="email" value={userEmail} className="apple-input w-full" disabled />
          </div>

          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={isSavingProfile}
              className="bg-petroleum text-white px-6 py-2.5 rounded-xl font-semibold shadow-lg shadow-petroleum/20 hover:scale-105 active:scale-95 transition-all disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center gap-2"
            >
              <Save size={16} />
              {isSavingProfile ? "Salvando..." : "Salvar perfil"}
            </button>
          </div>
        </form>
      </div>

      {canAccessClinical && (
        <div className="glass-panel p-8 space-y-6">
          <div className="flex items-center gap-3">
            <SlidersHorizontal size={18} className="text-petroleum" />
            <h3 className="font-bold text-petroleum uppercase tracking-wider text-sm">
              Preferencias de nota
            </h3>
          </div>

          <form onSubmit={handleSavePreferences} className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Tom</label>
              <select
                value={preferences.tone}
                onChange={(e) =>
                  setPreferences((prev) => ({
                    ...prev,
                    tone: e.target.value === "empathetic" ? "empathetic" : "clinical",
                  }))
                }
                className="apple-input w-full appearance-none"
              >
                <option value="clinical">Clinico / objetivo</option>
                <option value="empathetic">Empatico / humanizado</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Comprimento
              </label>
              <select
                value={preferences.length}
                onChange={(e) =>
                  setPreferences((prev) => ({
                    ...prev,
                    length:
                      e.target.value === "short" || e.target.value === "long"
                        ? e.target.value
                        : "medium",
                  }))
                }
                className="apple-input w-full appearance-none"
              >
                <option value="short">Curto</option>
                <option value="medium">Medio</option>
                <option value="long">Longo</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Idioma
              </label>
              <select
                value={preferences.language}
                onChange={() =>
                  setPreferences((prev) => ({
                    ...prev,
                    language: "pt-BR",
                  }))
                }
                className="apple-input w-full appearance-none"
              >
                <option value="pt-BR">Portugues (Brasil)</option>
              </select>
            </div>

            <div className="md:col-span-3 flex justify-end">
              <button
                type="submit"
                disabled={isSavingPreferences}
                className="bg-petroleum text-white px-6 py-2.5 rounded-xl font-semibold shadow-lg shadow-petroleum/20 hover:scale-105 active:scale-95 transition-all disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center gap-2"
              >
                <Save size={16} />
                {isSavingPreferences ? "Salvando..." : "Salvar preferencias"}
              </button>
            </div>
          </form>
        </div>
      )}

      {canManageMembers && (
        <div className="glass-panel p-8 space-y-6">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-petroleum" />
            <h3 className="font-bold text-petroleum uppercase tracking-wider text-sm">
              Membros da clinica
            </h3>
          </div>
          <p className="text-sm text-slate-500">
            Controle os perfis de acesso: admin, professional e secretary.
          </p>

          <form onSubmit={handleInviteMember} className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <input
              type="email"
              value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
              placeholder="email@dominio.com"
              className="apple-input md:col-span-2"
            />
            <select
              value={memberRole}
              onChange={(e) =>
                setMemberRole(
                  e.target.value === "admin" || e.target.value === "professional"
                    ? e.target.value
                    : "secretary"
                )
              }
              className="apple-input appearance-none"
            >
              <option value="secretary">secretary</option>
              <option value="professional">professional</option>
              <option value="admin">admin</option>
            </select>
            <button
              type="submit"
              disabled={invitingMember}
              className="bg-petroleum text-white px-4 py-2.5 rounded-xl font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {invitingMember ? "Adicionando..." : "Adicionar membro"}
            </button>
          </form>

          <div className="space-y-3">
            {loadingMembers ? (
              <p className="text-sm text-slate-500">Carregando membros...</p>
            ) : members.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum membro adicional encontrado.</p>
            ) : (
              members.map((member) => (
                <div
                  key={member.id}
                  className="border border-black/10 rounded-xl p-4 flex flex-col md:flex-row md:items-center gap-3 md:gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-700 truncate">
                      {member.full_name || member.email || member.user_id}
                    </p>
                    <p className="text-xs text-slate-500 truncate">{member.email || member.user_id}</p>
                  </div>

                  <select
                    value={member.role || "secretary"}
                    onChange={(e) =>
                      handleUpdateMember(
                        Number(member.id),
                        e.target.value === "admin" || e.target.value === "professional"
                          ? e.target.value
                          : "secretary",
                        Boolean(member.active)
                      )
                    }
                    className="apple-input appearance-none min-w-[150px]"
                  >
                    <option value="secretary">secretary</option>
                    <option value="professional">professional</option>
                    <option value="admin">admin</option>
                  </select>

                  <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={Boolean(member.active)}
                      onChange={(e) =>
                        handleUpdateMember(
                          Number(member.id),
                          member.role === "admin" || member.role === "professional"
                            ? member.role
                            : "secretary",
                          e.target.checked
                        )
                      }
                    />
                    Ativo
                  </label>

                  <button
                    type="button"
                    onClick={() => handleRemoveMember(Number(member.id))}
                    className="px-3 py-2 rounded-lg text-error hover:bg-error/10"
                  >
                    Remover
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {canManageGoogle && (
        <div className="glass-panel p-8 space-y-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Link2 size={18} className="text-petroleum" />
              <h3 className="font-bold text-petroleum uppercase tracking-wider text-sm">
                Google Agenda
              </h3>
            </div>
            <span
              className={`text-xs font-bold px-3 py-1 rounded-full ${
                googleStatus?.connected ? "bg-success/10 text-success" : "bg-slate-700 text-white"
              }`}
            >
              {loadingGoogle
                ? "Carregando"
                : googleStatus?.connected
                ? "Conectado"
                : "Desconectado"}
            </span>
          </div>

          {googleStatus?.feature_enabled === false && (
            <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-warning text-sm flex items-start gap-2">
              <ShieldAlert size={16} className="mt-0.5" />
              Integracao Google desativada por feature flag no ambiente.
            </div>
          )}

          {googleStatus?.feature_enabled !== false && !googleStatus?.configured && (
            <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-warning text-sm flex items-start gap-2">
              <ShieldAlert size={16} className="mt-0.5" />
              Defina `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GOOGLE_REDIRECT_URI` no backend.
            </div>
          )}

          {googleStatus?.connected && (
            <div className="rounded-xl border border-black/10 p-4 text-sm text-slate-600 space-y-1">
              <p>
                <strong>Conta:</strong> {googleStatus.connection?.google_email || "Nao informado"}
              </p>
              <p>
                <strong>Expira em:</strong>{" "}
                {googleStatus.connection?.expires_at
                  ? new Date(googleStatus.connection.expires_at).toLocaleString("pt-BR")
                  : "-"}
              </p>
              <p>
                <strong>Canal webhook:</strong> {googleStatus.watch?.active ? "ativo" : "nao ativo"}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleGoogleConnect}
              disabled={connectingGoogle || !googleStatus?.configured}
              className="bg-petroleum text-white px-5 py-2.5 rounded-xl font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {connectingGoogle ? "Conectando..." : "Conectar Google"}
            </button>

            <button
              type="button"
              onClick={handleGoogleResync}
              disabled={resyncingGoogle || !googleStatus?.connected}
              className="bg-white border border-black/10 text-slate-700 px-5 py-2.5 rounded-xl font-semibold hover:bg-slate-50 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <RefreshCcw size={16} />
              {resyncingGoogle ? "Sincronizando..." : "Sincronizar agora"}
            </button>

            <button
              type="button"
              onClick={handleGoogleDisconnect}
              disabled={disconnectingGoogle || !googleStatus?.connected}
              className="bg-white border border-black/10 text-slate-700 px-5 py-2.5 rounded-xl font-semibold hover:bg-slate-50 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Unplug size={16} />
              {disconnectingGoogle ? "Desconectando..." : "Desconectar"}
            </button>
          </div>
        </div>
      )}

      {canManageAsaas && (
        <div className="glass-panel p-8 space-y-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Wallet size={18} className="text-petroleum" />
              <h3 className="font-bold text-petroleum uppercase tracking-wider text-sm">
                Asaas e cobranca
              </h3>
            </div>
            <span
              className={`text-xs font-bold px-3 py-1 rounded-full ${
                asaasConfigured ? "bg-success/10 text-success" : "bg-slate-700 text-white"
              }`}
            >
              {asaasConfigured ? "API ativa" : "API nao configurada"}
            </span>
          </div>

          {!asaasConfigured && (
            <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-warning text-sm">
              Defina `ASAAS_API_KEY` e, se necessario, `ASAAS_BASE_URL` no backend para operacao completa.
            </div>
          )}

          <form onSubmit={handleSaveAsaasSettings} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Preset de alertas
                </label>
                <select
                  value={reminderPreset}
                  onChange={(e) =>
                    setReminderPreset(
                      e.target.value === "light" || e.target.value === "intense"
                        ? e.target.value
                        : "standard"
                    )
                  }
                  className="apple-input w-full appearance-none"
                  disabled={loadingAsaasSettings}
                >
                  <option value="light">light</option>
                  <option value="standard">standard</option>
                  <option value="intense">intense</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Prazo padrao (dias)
                </label>
                <input
                  type="number"
                  min={0}
                  value={defaultDueDays}
                  onChange={(e) => setDefaultDueDays(Number(e.target.value || 0))}
                  className="apple-input w-full"
                  disabled={loadingAsaasSettings}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Canais ativos
                </label>
                <div className="flex items-center gap-3 h-[46px] px-4 rounded-xl border border-black/10 bg-white/50">
                  {["email", "sms", "whatsapp"].map((channel) => (
                    <label key={channel} className="inline-flex items-center gap-1.5 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={reminderChannels.includes(channel)}
                        onChange={() => toggleReminderChannel(channel)}
                      />
                      {channel}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Multa (%)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={lateFeePercent}
                  onChange={(e) => setLateFeePercent(Number(e.target.value || 0))}
                  className="apple-input w-full"
                  disabled={loadingAsaasSettings}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Juros (%)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={interestPercent}
                  onChange={(e) => setInterestPercent(Number(e.target.value || 0))}
                  className="apple-input w-full"
                  disabled={loadingAsaasSettings}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Timeline de lembretes (JSON)
              </label>
              <textarea
                rows={7}
                value={reminderTimelineText}
                onChange={(e) => setReminderTimelineText(e.target.value)}
                className="apple-input w-full font-mono text-xs leading-relaxed"
                placeholder='[{"days":2,"channel":"email"}]'
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingAsaasSettings || loadingAsaasSettings}
                className="bg-petroleum text-white px-6 py-2.5 rounded-xl font-semibold shadow-lg shadow-petroleum/20 hover:scale-105 active:scale-95 transition-all disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center gap-2"
              >
                <Save size={16} />
                {savingAsaasSettings ? "Salvando..." : "Salvar Asaas"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="glass-panel p-8 space-y-6">
        <h3 className="font-bold text-petroleum uppercase tracking-wider text-sm">Dados e sessao</h3>

        <div className="flex flex-wrap gap-3">
          {canAccessClinical && (
            <button
              onClick={handleExportNotes}
              disabled={isExporting}
              className="bg-white border border-black/10 text-slate-700 px-5 py-2.5 rounded-xl font-semibold hover:bg-slate-50 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Download size={16} />
              {isExporting ? "Exportando..." : "Exportar notas JSON"}
            </button>
          )}

          <button
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="bg-white border border-black/10 text-slate-700 px-5 py-2.5 rounded-xl font-semibold hover:bg-slate-50 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <LogOut size={16} />
            {isSigningOut ? "Saindo..." : "Encerrar sessao"}
          </button>
        </div>
      </div>
    </div>
  );
};
