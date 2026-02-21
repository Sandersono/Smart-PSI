import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  Mic, 
  Square, 
  ShieldCheck, 
  Clock, 
  RotateCcw,
  ArrowLeft,
  AlertCircle
} from 'lucide-react';
import { cn } from '../lib/utils';
import { processAudioToNote } from '../services/aiService';

interface RecorderProps {
  onCancel: () => void;
  onComplete: (noteData: any) => void;
  initialPatientId?: string;
}

export const Recorder = ({ onCancel, onComplete, initialPatientId }: RecorderProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'processing'>('idle');
  const [patients, setPatients] = useState<any[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState(initialPatientId || '');
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  useEffect(() => {
    fetchPatients();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
    };
  }, []);

  const fetchPatients = async () => {
    const res = await fetch('/api/patients');
    const data = await res.json();
    setPatients(data);
  };

  const startRecording = async () => {
    if (!consent || !selectedPatientId) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      
      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        handleProcessAudio(blob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = window.setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      audioContextRef.current = new AudioContext();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      source.connect(analyserRef.current);
      drawWaveform();
    } catch (err) {
      console.error("Mic error:", err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const drawWaveform = () => {
    if (!canvasRef.current || !analyserRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const analyser = analyserRef.current;
    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!analyserRef.current) return;
      requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2;
        ctx.fillStyle = `rgba(11, 91, 110, ${barHeight / 100})`;
        ctx.fillRect(x, canvas.height / 2 - barHeight / 2, barWidth, barHeight);
        x += barWidth + 1;
      }
    };
    draw();
  };

  const handleProcessAudio = async (blob: Blob) => {
    setStatus('uploading');
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = async () => {
      const base64data = (reader.result as string).split(',')[1];
      setStatus('processing');
      try {
        const result = await processAudioToNote(base64data, blob.type);
        onComplete({ ...result, patient_id: selectedPatientId });
      } catch (error) {
        console.error("AI Error:", error);
        setStatus('idle');
      }
    };
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="max-w-3xl mx-auto">
      <button onClick={onCancel} className="flex items-center gap-2 text-slate-500 hover:text-petroleum mb-8 transition-colors">
        <ArrowLeft size={20} />
        Cancelar e Voltar
      </button>

      <div className="glass-panel p-12 text-center space-y-10">
        <div className="space-y-3">
          <h2 className="text-4xl font-bold tracking-tight text-petroleum">Nova Sessão</h2>
          <p className="text-slate-500 text-lg">Grave o áudio da sessão para gerar a nota clínica automaticamente.</p>
        </div>

        <div className="flex flex-col items-center gap-8">
          <div className="w-full max-w-md space-y-2 text-left">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Selecionar Paciente</label>
            <select 
              disabled={isRecording || status !== 'idle'}
              value={selectedPatientId}
              onChange={(e) => setSelectedPatientId(e.target.value)}
              className="apple-input w-full appearance-none"
            >
              <option value="">Escolha o paciente para esta sessão</option>
              {patients.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="w-full h-48 bg-white/40 backdrop-blur-md rounded-[2.5rem] border border-white/60 relative overflow-hidden flex items-center justify-center shadow-inner">
            {isRecording ? (
              <canvas ref={canvasRef} width={600} height={150} className="w-full h-full" />
            ) : (
              <div className="text-slate-300 flex flex-col items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center">
                  <Mic size={32} />
                </div>
                <span className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400">Pronto para iniciar</span>
              </div>
            )}
            {isRecording && (
              <div className="absolute top-6 right-8 flex items-center gap-3 px-4 py-2 bg-error/10 text-error rounded-full text-sm font-bold animate-pulse border border-error/20">
                <div className="w-2.5 h-2.5 bg-error rounded-full" />
                GRAVANDO {formatTime(recordingTime)}
              </div>
            )}
          </div>

          <div className="flex items-center gap-4 p-5 bg-white/50 backdrop-blur-sm rounded-2xl border border-white/60 max-w-md">
            <input 
              type="checkbox" 
              id="consent" 
              checked={consent} 
              onChange={(e) => setConsent(e.target.checked)}
              className="w-6 h-6 rounded-lg border-slate-300 text-petroleum focus:ring-petroleum transition-all cursor-pointer"
            />
            <label htmlFor="consent" className="text-sm text-slate-600 font-medium cursor-pointer leading-tight text-left">
              Confirmo que o paciente forneceu consentimento explícito para a gravação desta sessão.
            </label>
          </div>

          <div className="flex items-center gap-8">
            {!isRecording ? (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={startRecording}
                disabled={!consent || status !== 'idle'}
                className={cn(
                  "w-24 h-24 rounded-full flex items-center justify-center transition-all shadow-2xl",
                  consent && status === 'idle' ? "bg-success text-white shadow-success/20" : "bg-slate-200 text-slate-400 cursor-not-allowed"
                )}
              >
                <Mic size={40} />
              </motion.button>
            ) : (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={stopRecording}
                className="w-24 h-24 rounded-full bg-error text-white flex items-center justify-center shadow-2xl shadow-error/20"
              >
                <Square size={40} />
              </motion.button>
            )}
          </div>
        </div>

        {status !== 'idle' && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6 pt-10 border-t border-black/5"
          >
            <div className="flex justify-between items-end">
              <div className="text-left">
                <p className="text-lg font-bold text-petroleum">
                  {status === 'uploading' ? 'Enviando áudio...' : 'Gerando nota clínica...'}
                </p>
                <p className="text-sm text-slate-400">Isso pode levar até 2 minutos.</p>
              </div>
              <span className="text-petroleum font-mono font-bold">90%</span>
            </div>
            <div className="h-3 bg-slate-100 rounded-full overflow-hidden p-0.5 border border-black/5">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: status === 'uploading' ? '40%' : '90%' }}
                className="h-full bg-petroleum rounded-full shadow-[0_0_10px_rgba(11,91,110,0.3)]"
              />
            </div>
            <div className="flex items-center justify-center gap-2 text-xs text-slate-400 font-medium">
              <ShieldCheck size={14} className="text-success" />
              Privacidade garantida: o áudio será apagado após o processamento.
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};
