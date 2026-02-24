/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { AnimatePresence, motion } from "motion/react";
import { Sidebar } from "./components/Sidebar";
import { Dashboard } from "./components/Dashboard";
import { Recorder } from "./components/Recorder";
import { NoteEditor } from "./components/NoteEditor";
import { Patients } from "./components/Patients";
import { PatientProfile } from "./components/PatientProfile";
import { Agenda } from "./components/Agenda";
import { Financial } from "./components/Financial";
import { Settings } from "./components/Settings";
import { Help } from "./components/Help";
import { Auth } from "./components/Auth";
import { Toast } from "./components/Toast";
import { AUTH_EXPIRED_EVENT, ApiError, apiRequest } from "./lib/api";
import { supabase } from "./lib/supabaseClient";
import { Note } from "./lib/utils";
import { Patient, UserRole } from "./lib/types";

type NoteSource = "audio" | "quick" | "manual";
type MeResponse = {
  user_id: string;
  clinic_id: string;
  role: UserRole;
};

export default function App() {
  const [view, setView] = useState<
    | "dashboard"
    | "record"
    | "note"
    | "settings"
    | "help"
    | "patients"
    | "patient_profile"
    | "agenda"
    | "financial"
  >("dashboard");
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [currentNote, setCurrentNote] = useState<Partial<Note> | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  const [loadingMe, setLoadingMe] = useState(false);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [isDeletingNote, setIsDeletingNote] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [forcePasswordReset, setForcePasswordReset] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.location.hash.includes("type=recovery");
  });
  const authExpireInFlightRef = useRef(false);
  const accessToken = session?.access_token || "";
  const userRole: UserRole = me?.role || "professional";
  const userName = session?.user.user_metadata?.full_name || "Profissional";
  const userEmail = session?.user.email || "";

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
    if (!session) {
      setMe(null);
      setNotes([]);
      return;
    }
    fetchMe();
  }, [session?.access_token]);

  useEffect(() => {
    if (!session) {
      setNotes([]);
      return;
    }
    if (userRole === "secretary") {
      setNotes([]);
      return;
    }
    fetchNotes();
  }, [session?.access_token, userRole]);

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
        setToast({
          type: "error",
          message: "Sessao expirada. Faca login novamente.",
        });
        await supabase.auth.signOut();
        setSession(null);
        setMe(null);
        setCurrentNote(null);
        setSelectedPatient(null);
        setNotes([]);
      } finally {
        authExpireInFlightRef.current = false;
      }
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthExpired as EventListener);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthExpired as EventListener);
    };
  }, []);

  useEffect(() => {
    if (me?.role !== "secretary") return;
    if (view === "dashboard" || view === "record" || view === "note") {
      setView("agenda");
    }
  }, [me?.role, view]);

  const notify = (type: "success" | "error" | "info", message: string) => {
    setToast({ type, message });
  };

  const refreshSession = async () => {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    if (data.session?.access_token) {
      await fetchMe();
    }
  };

  const fetchMe = async () => {
    if (!session?.access_token) return;
    setLoadingMe(true);
    setMeError(null);
    try {
      const data = await apiRequest<MeResponse>("/api/me", session.access_token);
      setMe(data);
    } catch (error) {
      console.error("Failed to load user context", error);
      if (error instanceof ApiError) {
        setMeError(error.message || "Falha ao carregar contexto da clinica.");
      } else {
        setMeError("Falha ao carregar contexto da clinica.");
      }
      setMe(null);
    } finally {
      setLoadingMe(false);
    }
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
      fetchNotes();
      setView("dashboard");
      setCurrentNote(null);
      notify("success", status === "final" ? "Nota finalizada com sucesso." : "Nota salva com sucesso.");
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

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setView("dashboard");
    setCurrentNote(null);
    setSelectedPatient(null);
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
        onPasswordUpdated={() => {
          setForcePasswordReset(false);
          if (typeof window !== "undefined") {
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        }}
      />
    );
  }

  if (loadingMe && !me) {
    return (
      <div className="min-h-screen bg-[#F7F8FA] flex items-center justify-center text-slate-500">
        Carregando contexto da clinica...
      </div>
    );
  }

  if (meError && !me) {
    return (
      <div className="min-h-screen bg-[#F7F8FA] flex items-center justify-center p-6">
        <div className="glass-panel max-w-2xl p-8 space-y-4">
          <h2 className="text-2xl font-bold text-petroleum">Configuracao pendente do banco</h2>
          <p className="text-slate-600">{meError}</p>
          <p className="text-sm text-slate-500">
            Execute no Supabase SQL Editor: `supabase/migrations/20260221_002_clinic_rbac_agenda_asaas.sql`,
            `supabase/migrations/20260221_003_google_agenda_notes_source.sql` e
            `supabase/migrations/20260221_004_financial_monthly_asaas_settings.sql`,
            `supabase/migrations/20260222_005_ai_usage_meter.sql` e
            `supabase/migrations/20260224_006_patient_linkage_guardrails.sql`.
          </p>
        </div>
      </div>
    );
  }

  const isClinicalRole = userRole === "admin" || userRole === "professional";
  const canOpenDashboard = isClinicalRole;
  const canOpenRecorder = isClinicalRole;

  return (
    <div className="flex min-h-screen bg-[#F7F8FA]">
      {toast && <Toast type={toast.type} message={toast.message} />}
      <Sidebar
        activeView={view === "patient_profile" ? "patients" : view}
        onViewChange={(nextView) =>
          setView(
            nextView as
              | "dashboard"
              | "record"
              | "note"
              | "settings"
              | "help"
              | "patients"
              | "patient_profile"
              | "agenda"
              | "financial"
          )
        }
        onSignOut={handleSignOut}
        userName={userName}
        userEmail={userEmail}
        role={userRole}
      />

      <main className="flex-1 p-8 lg:p-12 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            {view === "dashboard" && canOpenDashboard && (
              <Dashboard
                notes={notes}
                accessToken={accessToken}
                userName={userName}
                onNewSession={() => {
                  setSelectedPatient(null);
                  setView("record");
                }}
                onQuickNote={handleQuickNote}
                onOpenNote={(note) => {
                  setCurrentNote(note);
                  setView("note");
                }}
              />
            )}

            {view === "record" && canOpenRecorder && (
              <Recorder
                accessToken={accessToken}
                onCancel={() => setView("dashboard")}
                onComplete={handleNoteComplete}
                initialPatientId={selectedPatient?.id?.toString()}
              />
            )}

            {view === "note" && canOpenRecorder && currentNote && (
              <NoteEditor
                accessToken={accessToken}
                note={currentNote}
                onSave={handleSaveNote}
                onDelete={handleDeleteNote}
                isSaving={isSavingNote}
                isDeleting={isDeletingNote}
                onCancel={() => setView("dashboard")}
                onChange={setCurrentNote}
                onReprocess={() => {
                  if (currentNote?.source !== "audio") return;
                  if (currentNote?.patient_id) {
                    const patientId = Number(currentNote.patient_id);
                    if (!Number.isFinite(patientId)) {
                      setSelectedPatient(null);
                    } else {
                      setSelectedPatient({
                        id: patientId,
                        name: "Paciente",
                        email: null,
                        phone: null,
                        birth_date: null,
                        cpf: null,
                        address: null,
                        notes: null,
                        created_at: new Date().toISOString(),
                        session_fee: null,
                        billing_mode_override: null,
                      });
                    }
                  } else {
                    setSelectedPatient(null);
                  }
                  setView("record");
                }}
              />
            )}

            {view === "patients" && (
              <Patients
                accessToken={accessToken}
                role={userRole}
                onSelectPatient={(p) => {
                  setSelectedPatient(p);
                  setView("patient_profile");
                }}
              />
            )}

            {view === "patient_profile" && selectedPatient && (
              <PatientProfile
                accessToken={accessToken}
                patient={selectedPatient}
                role={userRole}
                onBack={() => setView("patients")}
                onNewSession={(patientId) => {
                  const parsedPatientId = Number(patientId);
                  setSelectedPatient((prev) =>
                    prev ? { ...prev, id: Number.isFinite(parsedPatientId) ? parsedPatientId : prev.id } : prev
                  );
                  setView("record");
                }}
              />
            )}

            {view === "agenda" && (
              <Agenda
                accessToken={accessToken}
                onStartSession={(patient) => {
                  const patientId = Number(patient.id);
                  setSelectedPatient({
                    id: Number.isFinite(patientId) ? patientId : 0,
                    name: patient.name,
                    email: null,
                    phone: null,
                    birth_date: null,
                    cpf: null,
                    address: null,
                    notes: null,
                    created_at: new Date().toISOString(),
                    session_fee: null,
                    billing_mode_override: null,
                  });
                  setView("record");
                }}
              />
            )}
            {view === "financial" && <Financial accessToken={accessToken} role={userRole} />}
            {view === "settings" && (
              <Settings
                accessToken={accessToken}
                role={userRole}
                userName={userName}
                userEmail={userEmail}
                onSignOut={handleSignOut}
                onSessionRefresh={refreshSession}
                onNotesChanged={fetchNotes}
              />
            )}
            {view === "help" && <Help />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
