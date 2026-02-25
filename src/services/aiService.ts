import { apiRequest } from "../lib/api";
import { NotePreferences } from "../lib/preferences";

interface ProcessAudioResult {
  complaint: string;
  intervention: string;
  next_focus: string;
  usage?: {
    model: string;
    input_seconds: number;
    total_tokens_estimated: number;
    estimated_cost: number;
    currency: string;
  };
}

export async function processAudioToNote(
  audioBase64: string,
  mimeType: string,
  accessToken: string,
  preferences?: NotePreferences,
  patientId?: string | number | null
) {
  return apiRequest<ProcessAudioResult>("/api/ai/process-audio", accessToken, {
    method: "POST",
    body: JSON.stringify({ audioBase64, mimeType, preferences, patient_id: patientId ?? null }),
  });
}
