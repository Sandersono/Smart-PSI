export const NOTE_PREFERENCES_KEY = "smartpsi_note_preferences";

export type NotePreferences = {
  tone: "clinical" | "empathetic";
  length: "short" | "medium" | "long";
  language: "pt-BR";
};

export const defaultNotePreferences: NotePreferences = {
  tone: "clinical",
  length: "medium",
  language: "pt-BR",
};

export function readNotePreferences(): NotePreferences {
  try {
    const raw = window.localStorage.getItem(NOTE_PREFERENCES_KEY);
    if (!raw) return defaultNotePreferences;
    const parsed = JSON.parse(raw);
    return {
      tone: parsed?.tone === "empathetic" ? "empathetic" : "clinical",
      length:
        parsed?.length === "short" || parsed?.length === "long"
          ? parsed.length
          : "medium",
      language: "pt-BR",
    };
  } catch {
    return defaultNotePreferences;
  }
}

export function saveNotePreferences(preferences: NotePreferences) {
  window.localStorage.setItem(NOTE_PREFERENCES_KEY, JSON.stringify(preferences));
}
