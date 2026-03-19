import React, { Suspense, lazy } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Note } from "../../lib/utils";
import { Patient, UserRole } from "../../lib/types";
import { ClinicWorkspaceView } from "../../lib/workspaceRoutes";

const Dashboard = lazy(async () => ({ default: (await import("../Dashboard")).Dashboard }));
const Recorder = lazy(async () => ({ default: (await import("../Recorder")).Recorder }));
const NoteEditor = lazy(async () => ({ default: (await import("../NoteEditor")).NoteEditor }));
const Patients = lazy(async () => ({ default: (await import("../Patients")).Patients }));
const PatientProfile = lazy(
  async () => ({ default: (await import("../PatientProfile")).PatientProfile })
);
const Agenda = lazy(async () => ({ default: (await import("../Agenda")).Agenda }));
const Financial = lazy(async () => ({ default: (await import("../Financial")).Financial }));
const Inbox = lazy(async () => ({ default: (await import("../Inbox")).Inbox }));
const Settings = lazy(async () => ({ default: (await import("../Settings")).Settings }));
const Help = lazy(async () => ({ default: (await import("../Help")).Help }));

type ClinicWorkspaceContentProps = {
  view: ClinicWorkspaceView;
  notes: Note[];
  accessToken: string;
  userName: string;
  userEmail: string;
  role: UserRole;
  currentNote: Partial<Note> | null;
  selectedPatient: Patient | null;
  isSavingNote: boolean;
  isDeletingNote: boolean;
  canOpenDashboard: boolean;
  canOpenRecorder: boolean;
  setView: React.Dispatch<React.SetStateAction<ClinicWorkspaceView>>;
  setCurrentNote: React.Dispatch<React.SetStateAction<Partial<Note> | null>>;
  setSelectedPatient: React.Dispatch<React.SetStateAction<Patient | null>>;
  onNoteComplete: (noteData: Partial<Note>) => void;
  onQuickNote: () => void;
  onSaveNote: (nextStatus?: "draft" | "final") => Promise<void>;
  onDeleteNote: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onSessionRefresh: () => Promise<void>;
  onNotesChanged: () => Promise<void>;
};

const viewLabelMap: Record<ClinicWorkspaceView, string> = {
  dashboard: "Dashboard",
  record: "Atendimento",
  note: "Nota clinica",
  patients: "Pacientes",
  patient_profile: "Perfil do paciente",
  agenda: "Agenda",
  financial: "Financeiro",
  settings: "Configuracoes",
  help: "Ajuda",
  inbox: "Inbox",
};

const buildSessionPatient = (patientId: string | number, patientName: string) => {
  const parsedPatientId = Number(patientId);
  return {
    id: Number.isFinite(parsedPatientId) ? parsedPatientId : 0,
    name: patientName,
    email: null,
    phone: null,
    birth_date: null,
    cpf: null,
    address: null,
    notes: null,
    created_at: new Date().toISOString(),
    session_fee: null,
    billing_mode_override: null,
  } satisfies Patient;
};

export const ClinicWorkspaceContent = ({
  view,
  notes,
  accessToken,
  userName,
  userEmail,
  role,
  currentNote,
  selectedPatient,
  isSavingNote,
  isDeletingNote,
  canOpenDashboard,
  canOpenRecorder,
  setView,
  setCurrentNote,
  setSelectedPatient,
  onNoteComplete,
  onQuickNote,
  onSaveNote,
  onDeleteNote,
  onSignOut,
  onSessionRefresh,
  onNotesChanged,
}: ClinicWorkspaceContentProps) => {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={view}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <Suspense
          fallback={
            <div className="glass-panel p-8 space-y-3">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Workspace</p>
              <h2 className="text-2xl font-semibold text-petroleum">{viewLabelMap[view]}</h2>
              <p className="text-sm text-slate-500">Carregando modulo selecionado...</p>
            </div>
          }
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
              onQuickNote={onQuickNote}
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
              onComplete={onNoteComplete}
              initialPatientId={selectedPatient?.id?.toString()}
            />
          )}

          {view === "note" && canOpenRecorder && currentNote && (
            <NoteEditor
              accessToken={accessToken}
              note={currentNote}
              onSave={onSaveNote}
              onDelete={onDeleteNote}
              isSaving={isSavingNote}
              isDeleting={isDeletingNote}
              onCancel={() => setView("dashboard")}
              onChange={setCurrentNote}
              onReprocess={() => {
                if (currentNote.source !== "audio") return;
                if (!currentNote.patient_id) {
                  setSelectedPatient(null);
                  setView("record");
                  return;
                }

                const patientId = Number(currentNote.patient_id);
                if (!Number.isFinite(patientId)) {
                  setSelectedPatient(null);
                } else {
                  setSelectedPatient(buildSessionPatient(patientId, "Paciente"));
                }
                setView("record");
              }}
            />
          )}

          {view === "patients" && (
            <Patients
              accessToken={accessToken}
              role={role}
              onSelectPatient={(patient) => {
                setSelectedPatient(patient);
                setView("patient_profile");
              }}
            />
          )}

          {view === "patient_profile" && selectedPatient && (
            <PatientProfile
              accessToken={accessToken}
              patient={selectedPatient}
              role={role}
              onBack={() => setView("patients")}
              onNewSession={(patientId) => {
                const parsedPatientId = Number(patientId);
                setSelectedPatient((previous) =>
                  previous
                    ? {
                        ...previous,
                        id: Number.isFinite(parsedPatientId) ? parsedPatientId : previous.id,
                      }
                    : previous
                );
                setView("record");
              }}
            />
          )}

          {view === "agenda" && (
            <Agenda
              accessToken={accessToken}
              onStartSession={(patient) => {
                setSelectedPatient(buildSessionPatient(patient.id, patient.name));
                setView("record");
              }}
            />
          )}

          {view === "inbox" && <Inbox accessToken={accessToken} />}
          {view === "financial" && <Financial accessToken={accessToken} role={role} />}
          {view === "settings" && (
            <Settings
              accessToken={accessToken}
              role={role}
              userName={userName}
              userEmail={userEmail}
              onSignOut={onSignOut}
              onSessionRefresh={onSessionRefresh}
              onNotesChanged={onNotesChanged}
            />
          )}
          {view === "help" && <Help />}
        </Suspense>
      </motion.div>
    </AnimatePresence>
  );
};
