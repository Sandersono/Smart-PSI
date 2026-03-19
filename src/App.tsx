/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import { Auth } from "./components/Auth";
import { ClinicWorkspaceContent } from "./components/app/ClinicWorkspaceContent";
import { ClinicWorkspaceShell } from "./components/app/ClinicWorkspaceShell";
import { apiRequest, setStoredActiveClinicId } from "./lib/api";
import { useClinicAuthSession } from "./hooks/useClinicAuthSession";
import { useClinicSessionContext } from "./hooks/useClinicSessionContext";
import { Note } from "./lib/utils";
import { Patient, UserRole } from "./lib/types";
import {
  ClinicWorkspaceView,
  buildClinicWorkspacePath,
  parseClinicWorkspaceView,
  syncBrowserPath,
} from "./lib/workspaceRoutes";

type NoteSource = "audio" | "quick" | "manual";

export default function App() {
  const [view, setView] = useState<ClinicWorkspaceView>(() => {
    if (typeof window === "undefined") return "dashboard";
    return parseClinicWorkspaceView(window.location.pathname, "dashboard");
  });
  const [notes, setNotes] = useState<Note[]>([]);
  const [currentNote, setCurrentNote] = useState<Partial<Note> | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [isDeletingNote, setIsDeletingNote] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(
    null
  );

  const notify = (type: "success" | "error" | "info", message: string) => {
    setToast({ type, message });
  };

  const resetWorkspaceState = () => {
    setView("dashboard");
    setCurrentNote(null);
    setSelectedPatient(null);
    setNotes([]);
  };

  const {
    session,
    authReady,
    forcePasswordReset,
    clearPasswordRecovery,
    refreshSession: refreshAuthSession,
    signOut,
  } = useClinicAuthSession({
    notify,
    onSessionInvalidated: resetWorkspaceState,
  });
  const { sessionContext, sessionContextError, loadingSessionContext, refreshSessionContext } =
    useClinicSessionContext(session);
  const accessToken = session?.access_token || "";
  const activeMembership = sessionContext?.active_membership || null;
  const userRole: UserRole = activeMembership?.role || "professional";
  const userName = session?.user.user_metadata?.full_name || "Profissional";
  const userEmail = session?.user.email || "";

  useEffect(() => {
    if (!session) {
      setNotes([]);
      return;
    }
    if (userRole === "secretary") {
      setNotes([]);
      return;
    }
    void fetchNotes();
  }, [session?.access_token, userRole]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => {
      setToast(null);
    }, 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (activeMembership?.role !== "secretary") return;
    if (view === "dashboard" || view === "record" || view === "note") {
      setView("agenda");
    }
  }, [activeMembership?.role, view]);

  useEffect(() => {
    syncBrowserPath(buildClinicWorkspacePath(view), "replace");
  }, [view]);

  const refreshWorkspaceSession = async () => {
    const nextSession = await refreshAuthSession();
    await refreshSessionContext(nextSession?.access_token);
  };

  const hasRequiredFinalFields = (note: Partial<Note>) => {
    const hasPatient = Boolean(note.patient_id);
    const hasComplaint = Boolean(String(note.complaint || "").trim());
    const hasIntervention = Boolean(String(note.intervention || "").trim());
    const hasNextFocus = Boolean(String(note.next_focus || "").trim());
    return hasPatient && hasComplaint && hasIntervention && hasNextFocus;
  };

  const fetchNotes = async () => {
    try {
      const data = await apiRequest<Note[]>("/api/notes", accessToken);
      setNotes(data || []);
    } catch (error) {
      console.error("Failed to fetch notes", error);
      setNotes([]);
    }
  };

  const handleNoteComplete = (noteData: Partial<Note>) => {
    setCurrentNote({
      ...noteData,
      patient_id: noteData.patient_id || "",
      observations: "",
      status: "draft",
      source: "audio" as NoteSource,
    });
    setView("note");
  };

  const handleQuickNote = () => {
    setCurrentNote({
      patient_id: "",
      complaint: "",
      intervention: "",
      next_focus: "",
      observations: "",
      status: "draft",
      source: "quick",
      created_at: new Date().toISOString(),
    });
    setView("note");
  };

  const handleSaveNote = async (nextStatus?: "draft" | "final") => {
    if (!currentNote) return;
    const status = nextStatus || currentNote.status || "draft";

    if (status === "final" && !hasRequiredFinalFields(currentNote)) {
      notify("error", "Para finalizar, preencha paciente, queixa, intervencao e proximo foco.");
      return;
    }
    if ((currentNote.source || "manual") === "quick" && !currentNote.patient_id) {
      notify("error", "Nota rapida exige paciente vinculado para salvar no historico.");
      return;
    }

    setIsSavingNote(true);
    try {
      const payload = {
        ...currentNote,
        status,
        source: (currentNote.source || "manual") as NoteSource,
      };
      const noteId = currentNote.id ? Number(currentNote.id) : null;

      if (noteId) {
        await apiRequest<{ id: number }>(`/api/notes/${noteId}`, accessToken, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest<{ id: number }>("/api/notes", accessToken, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      await fetchNotes();
      setView("dashboard");
      setCurrentNote(null);
      notify(
        "success",
        status === "final" ? "Nota finalizada com sucesso." : "Nota salva com sucesso."
      );
    } catch (error) {
      console.error("Failed to save note", error);
      notify("error", "Falha ao salvar a nota.");
    } finally {
      setIsSavingNote(false);
    }
  };

  const handleDeleteNote = async () => {
    if (!currentNote?.id) return;
    const confirmed = window.confirm("Excluir esta nota?");
    if (!confirmed) return;

    setIsDeletingNote(true);
    try {
      await apiRequest<{ success: boolean }>(`/api/notes/${currentNote.id}`, accessToken, {
        method: "DELETE",
      });
      await fetchNotes();
      setView("dashboard");
      setCurrentNote(null);
      notify("success", "Nota excluida com sucesso.");
    } catch (error) {
      console.error("Failed to delete note", error);
      notify("error", "Falha ao excluir a nota.");
    } finally {
      setIsDeletingNote(false);
    }
  };

  const handleClinicChange = (clinicId: string) => {
    if (!clinicId || clinicId === activeMembership?.clinic_id) return;
    setStoredActiveClinicId(clinicId);
    window.location.reload();
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#F7F8FA] flex items-center justify-center text-slate-500">
        Carregando...
      </div>
    );
  }

  if (!session || forcePasswordReset) {
    return (
      <Auth
        initialMode={forcePasswordReset ? "update" : "signin"}
        onPasswordUpdated={clearPasswordRecovery}
      />
    );
  }

  if (loadingSessionContext && !sessionContext) {
    return (
      <div className="min-h-screen bg-[#F7F8FA] flex items-center justify-center text-slate-500">
        Carregando contexto da clinica...
      </div>
    );
  }

  if (sessionContextError && !sessionContext) {
    const schemaError = sessionContextError.toLowerCase().includes("schema");
    return (
      <div className="min-h-screen bg-[#F7F8FA] flex items-center justify-center p-6">
        <div className="glass-panel max-w-2xl p-8 space-y-4">
          <h2 className="text-2xl font-bold text-petroleum">
            {schemaError ? "Configuracao pendente do banco" : "Acesso indisponivel"}
          </h2>
          <p className="text-slate-600">{sessionContextError}</p>
          {schemaError ? (
            <p className="text-sm text-slate-500">
              Execute no Supabase SQL Editor:
              {` supabase/migrations/20260221_002_clinic_rbac_agenda_asaas.sql,`}
              {` supabase/migrations/20260221_003_google_agenda_notes_source.sql,`}
              {` supabase/migrations/20260221_004_financial_monthly_asaas_settings.sql,`}
              {` supabase/migrations/20260222_005_ai_usage_meter.sql,`}
              {` supabase/migrations/20260224_006_patient_linkage_guardrails.sql e`}
              {` supabase/migrations/20260225_007_superadmin_platform_foundation.sql.`}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  const isClinicalRole = userRole === "admin" || userRole === "professional";
  const canOpenDashboard = isClinicalRole;
  const canOpenRecorder = isClinicalRole;

  return (
    <ClinicWorkspaceShell
      toast={toast}
      activeView={view}
      onViewChange={setView}
      onSignOut={signOut}
      userName={userName}
      userEmail={userEmail}
      role={userRole}
      platformRole={sessionContext?.platform_role}
      activeClinicId={activeMembership?.clinic_id}
      activeClinicName={activeMembership?.clinic_name}
      clinicOptions={(sessionContext?.memberships || []).map((membership) => ({
        id: membership.clinic_id,
        label: membership.clinic_name || membership.clinic_slug || membership.clinic_id,
      }))}
      onClinicChange={handleClinicChange}
      onOpenPlatform={() => {
        if (typeof window === "undefined") return;
        window.location.assign("/admin");
      }}
    >
      <ClinicWorkspaceContent
        view={view}
        notes={notes}
        accessToken={accessToken}
        userName={userName}
        userEmail={userEmail}
        role={userRole}
        currentNote={currentNote}
        selectedPatient={selectedPatient}
        isSavingNote={isSavingNote}
        isDeletingNote={isDeletingNote}
        canOpenDashboard={canOpenDashboard}
        canOpenRecorder={canOpenRecorder}
        setView={setView}
        setCurrentNote={setCurrentNote}
        setSelectedPatient={setSelectedPatient}
        onNoteComplete={handleNoteComplete}
        onQuickNote={handleQuickNote}
        onSaveNote={handleSaveNote}
        onDeleteNote={handleDeleteNote}
        onSignOut={signOut}
        onSessionRefresh={refreshWorkspaceSession}
        onNotesChanged={fetchNotes}
      />
    </ClinicWorkspaceShell>
  );
}
