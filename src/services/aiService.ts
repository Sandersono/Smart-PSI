import { apiRequest } from "../lib/api";
import { NotePreferences } from "../lib/preferences";

interface ProcessAudioResult {
  complaint: string;
  intervention: string;
  next_focus: string;
}

export async function processAudioToNote(
  audioBase64: string,
  mimeType: string,
  accessToken: string,
  preferences?: NotePreferences
) {
  return apiRequest<ProcessAudioResult>("/api/ai/process-audio", accessToken, {
    method: "POST",
    body: JSON.stringify({ audioBase64, mimeType, preferences }),
  });
}
