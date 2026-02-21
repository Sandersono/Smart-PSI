/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { Recorder } from './components/Recorder';
import { NoteEditor } from './components/NoteEditor';
import { Patients } from './components/Patients';
import { PatientProfile } from './components/PatientProfile';
import { Agenda } from './components/Agenda';
import { Financial } from './components/Financial';
import { Settings } from './components/Settings';
import { Help } from './components/Help';
import { Note } from './lib/utils';

export default function App() {
  const [view, setView] = useState<'dashboard' | 'record' | 'note' | 'settings' | 'help' | 'patients' | 'patient_profile' | 'agenda' | 'financial'>('dashboard');
  const [notes, setNotes] = useState<Note[]>([]);
  const [currentNote, setCurrentNote] = useState<Partial<Note> | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<any>(null);

  useEffect(() => {
    fetchNotes();
  }, []);

  const fetchNotes = async () => {
    try {
      const res = await fetch('/api/notes');
      const data = await res.json();
      setNotes(data);
    } catch (error) {
      console.error("Failed to fetch notes", error);
    }
  };

  const handleNoteComplete = (noteData: any) => {
    setCurrentNote({
      ...noteData,
      patient_id: noteData.patient_id || '',
      observations: '',
      status: 'draft'
    });
    setView('note');
  };

  const handleSaveNote = async () => {
    if (!currentNote) return;
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentNote)
      });
      if (res.ok) {
        fetchNotes();
        setView('dashboard');
        setCurrentNote(null);
      }
    } catch (error) {
      console.error("Failed to save note", error);
    }
  };

  return (
    <div className="flex min-h-screen bg-[#F2F2F7]">
      <Sidebar activeView={view === 'patient_profile' ? 'patients' : view} onViewChange={setView} />
      
      <main className="flex-1 p-8 lg:p-12 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            {view === 'dashboard' && (
              <Dashboard 
                notes={notes} 
                onNewSession={() => {
                  setSelectedPatient(null);
                  setView('record');
                }} 
                onOpenNote={(note) => {
                  setCurrentNote(note);
                  setView('note');
                }}
              />
            )}

            {view === 'record' && (
              <Recorder 
                onCancel={() => setView('dashboard')} 
                onComplete={handleNoteComplete}
                initialPatientId={selectedPatient?.id?.toString()}
              />
            )}

            {view === 'note' && currentNote && (
              <NoteEditor 
                note={currentNote}
                onSave={handleSaveNote}
                onCancel={() => setView('dashboard')}
                onChange={setCurrentNote}
                onReprocess={() => setView('record')}
              />
            )}

            {view === 'patients' && (
              <Patients onSelectPatient={(p) => {
                setSelectedPatient(p);
                setView('patient_profile');
              }} />
            )}

            {view === 'patient_profile' && selectedPatient && (
              <PatientProfile 
                patient={selectedPatient} 
                onBack={() => setView('patients')} 
                onNewSession={(patientId) => {
                  setSelectedPatient(selectedPatient); // Already selected
                  setView('record');
                }}
              />
            )}

            {view === 'agenda' && <Agenda />}
            {view === 'financial' && <Financial />}
            {view === 'settings' && <Settings />}
            {view === 'help' && <Help />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
