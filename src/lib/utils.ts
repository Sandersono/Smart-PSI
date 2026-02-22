import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface Note {
  id: number;
  patient_id: string | number | null;
  complaint: string;
  intervention: string;
  next_focus: string;
  observations: string;
  created_at: string;
  status: 'draft' | 'final';
  source?: 'audio' | 'quick' | 'manual';
  patient_name?: string | null;
}
