import React, { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Mic, Square, ShieldCheck, ArrowLeft, AlertCircle } from "lucide-react";
import { cn } from "../lib/utils";
import { apiRequest } from "../lib/api";
import { readNotePreferences } from "../lib/preferences";
import { processAudioToNote } from "../services/aiService";

interface RecorderProps {
  accessToken: string;
  onCancel: () => void;
  onComplete: (noteData: any) => void;
  initialPatientId?: string;
}

export const Recorder = ({
  accessToken,
  onCancel,
  onComplete,
  initialPatientId,
}: RecorderProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<"idle" | "uploading" | "processing">("idle");
  const [patients, setPatients] = useState<any[]>([]);
  const [isLoadingPatients, setIsLoadingPatients] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState(initialPatientId || "");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    setSelectedPatientId(initialPatientId || "");
  }, [initialPatientId]);

  useEffect(() => {
    fetchPatients();
    return () => {
      cleanupRecorder();
    };
  }, [accessToken]);

  const fetchPatients = async () => {
    setIsLoadingPatients(true);
    try {
      const data = await apiRequest<any[]>("/api/patients", accessToken);
      setPatients(data || []);
    } catch (error) {
      console.error("Failed to load patients", error);
      setErrorMessage("Falha ao carregar pacientes para gravacao.");
    } finally {
      setIsLoadingPatients(false);
    }
  };

  const cleanupRecorder = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (mediaRecorderRef.current) {
      const tracks = mediaRecorderRef.current.stream?.getTracks() || [];
      tracks.forEach((track) => track.stop());
      mediaRecorderRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setIsRecording(false);
  };

  const startRecording = async () => {
    setErrorMessage(null);
    if (!consent) {
      setErrorMessage("Confirme o consentimento do paciente antes de gravar.");
      return;
    }
    if (!selectedPatientId) {
      setErrorMessage("Selecione um paciente para iniciar a sessao.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setErrorMessage("Seu navegador nao suporta gravacao de audio.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        cleanupRecorder();
        if (blob.size === 0) {
          setStatus("idle");
          setErrorMessage("Nao foi capturado audio. Tente gravar novamente.");
          return;
        }
        handleProcessAudio(blob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = window.setInterval(() => {
        setRecordingTime((previous) => previous + 1);
      }, 1000);

      audioContextRef.current = new AudioContext();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      source.connect(analyserRef.current);
      drawWaveform();
    } catch (error: any) {
      console.error("Mic error:", error);
      setErrorMessage(
        error?.name === "NotAllowedError"
          ? "Permissao de microfone negada."
          : "Nao foi possivel iniciar a gravacao."
      );
      setStatus("idle");
      cleanupRecorder();
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current) return;
    if (mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const drawWaveform = () => {
    if (!canvasRef.current || !analyserRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const analyser = analyserRef.current;
    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!analyserRef.current) return;
      analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;
      for (let i = 0; i < bufferLength; i += 1) {
        const barHeight = dataArray[i] / 2;
        ctx.fillStyle = `rgba(11, 91, 110, ${barHeight / 100})`;
        ctx.fillRect(x, canvas.height / 2 - barHeight / 2, barWidth, barHeight);
        x += barWidth + 1;
      }
      animationFrameRef.current = window.requestAnimationFrame(draw);
    };
    draw();
  };

  const handleProcessAudio = async (blob: Blob) => {
    setStatus("uploading");
    const reader = new FileReader();

    reader.onerror = () => {
      setStatus("idle");
      setErrorMessage("Falha ao ler o arquivo de audio.");
    };

    reader.onloadend = async () => {
      try {
        const resultRaw = String(reader.result || "");
        const base64data = resultRaw.split(",")[1];
        if (!base64data) {
          setStatus("idle");
          setErrorMessage("Falha ao converter audio para envio.");
          return;
        }

        setStatus("processing");
        const preferences = readNotePreferences();
        const result = await processAudioToNote(
          base64data,
          blob.type || "audio/webm",
          accessToken,
          preferences
        );
        onComplete({ ...result, patient_id: selectedPatientId });
      } catch (error) {
        console.error("AI Error:", error);
        setStatus("idle");
        setErrorMessage("Falha ao processar audio com IA. Tente novamente.");
      }
    };

    reader.readAsDataURL(blob);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="max-w-3xl mx-auto">
      <button
        onClick={onCancel}
        className="flex items-center gap-2 text-slate-500 hover:text-petroleum mb-8 transition-colors"
      >
        <ArrowLeft size={20} />
        Cancelar e voltar
      </button>

      <div className="glass-panel p-12 text-center space-y-10">
        <div className="space-y-3">
          <h2 className="text-4xl font-bold tracking-tight text-petroleum">Nova sessao</h2>
          <p className="text-slate-500 text-lg">
            Grave o audio da sessao para gerar a nota clinica automaticamente.
          </p>
        </div>

        {errorMessage && (
          <div className="rounded-xl border border-error/20 bg-error/10 text-error px-4 py-3 text-sm flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="flex flex-col items-center gap-8">
          <div className="w-full max-w-md space-y-2 text-left">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Selecionar paciente
            </label>
            <select
              disabled={isLoadingPatients || isRecording || status !== "idle"}
              value={selectedPatientId}
              onChange={(e) => setSelectedPatientId(e.target.value)}
              className="apple-input w-full appearance-none"
            >
              <option value="">
                {isLoadingPatients
                  ? "Carregando pacientes..."
                  : "Escolha o paciente para esta sessao"}
              </option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.name}
                </option>
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
                <span className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400">
                  Pronto para iniciar
                </span>
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
            <label
              htmlFor="consent"
              className="text-sm text-slate-600 font-medium cursor-pointer leading-tight text-left"
            >
              Confirmo que o paciente forneceu consentimento explicito para gravacao.
            </label>
          </div>

          <div className="flex items-center gap-8">
            {!isRecording ? (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={startRecording}
                disabled={!consent || status !== "idle" || isLoadingPatients}
                className={cn(
                  "w-24 h-24 rounded-full flex items-center justify-center transition-all shadow-2xl",
                  consent && status === "idle" && !isLoadingPatients
                    ? "bg-success text-white shadow-success/20"
                    : "bg-slate-200 text-slate-400 cursor-not-allowed"
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

        {status !== "idle" && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6 pt-10 border-t border-black/5"
          >
            <div className="flex justify-between items-end">
              <div className="text-left">
                <p className="text-lg font-bold text-petroleum">
                  {status === "uploading" ? "Enviando audio..." : "Gerando nota clinica..."}
                </p>
                <p className="text-sm text-slate-400">Isso pode levar ate 2 minutos.</p>
              </div>
              <span className="text-petroleum font-mono font-bold">90%</span>
            </div>
            <div className="h-3 bg-slate-100 rounded-full overflow-hidden p-0.5 border border-black/5">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: status === "uploading" ? "40%" : "90%" }}
                className="h-full bg-petroleum rounded-full shadow-[0_0_10px_rgba(11,91,110,0.3)]"
              />
            </div>
            <div className="flex items-center justify-center gap-2 text-xs text-slate-400 font-medium">
              <ShieldCheck size={14} className="text-success" />
              Privacidade garantida: o audio e apagado apos o processamento.
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};
