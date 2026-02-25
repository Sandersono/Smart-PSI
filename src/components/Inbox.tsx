import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  MessageCircle,
  RefreshCcw,
  Search,
  SendHorizonal,
  Tag,
  UserRound,
} from "lucide-react";
import { ApiError, apiRequest } from "../lib/api";
import { ClinicMember } from "../lib/types";

type ThreadStatus = "open" | "pending" | "resolved" | "blocked";
type IntegrationStatusPayload = {
  configured: boolean;
  connected: boolean;
  connection: {
    instance_name: string | null;
    api_base_url: string | null;
    status: "connected" | "disconnected" | "error";
  } | null;
};

type InboxThread = {
  id: number;
  clinic_id: string;
  channel: string;
  external_thread_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  status: ThreadStatus;
  assigned_user_id: string | null;
  labels: string[];
  unread_count: number;
  last_message_preview: string | null;
  last_message_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type InboxMessage = {
  id: number;
  thread_id: number;
  direction: "inbound" | "outbound" | "system";
  message_type: string;
  content: string | null;
  external_message_id: string | null;
  sender_name: string | null;
  sender_phone: string | null;
  sent_by_user_id: string | null;
  sent_at: string | null;
  status: string;
};

type ThreadListPayload = {
  threads: InboxThread[];
};

type ThreadMessagesPayload = {
  thread: InboxThread;
  messages: InboxMessage[];
};

const statusOptions: Array<{ value: ThreadStatus | "all"; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "open", label: "Aberto" },
  { value: "pending", label: "Pendente" },
  { value: "resolved", label: "Resolvido" },
  { value: "blocked", label: "Bloqueado" },
];

const statusLabels: Record<ThreadStatus, string> = {
  open: "Aberto",
  pending: "Pendente",
  resolved: "Resolvido",
  blocked: "Bloqueado",
};

const statusBadgeStyles: Record<ThreadStatus, string> = {
  open: "bg-success/15 text-success border-success/30",
  pending: "bg-warning/15 text-warning border-warning/30",
  resolved: "bg-petroleum/15 text-petroleum border-petroleum/30",
  blocked: "bg-error/15 text-error border-error/30",
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("pt-BR");
}

function buildLabelsInput(labels: string[] | null | undefined) {
  return Array.isArray(labels) ? labels.join(", ") : "";
}

export const Inbox = ({ accessToken }: { accessToken: string }) => {
  const [statusFilter, setStatusFilter] = useState<ThreadStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [members, setMembers] = useState<ClinicMember[]>([]);
  const [integration, setIntegration] = useState<IntegrationStatusPayload | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [savingThread, setSavingThread] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [composerText, setComposerText] = useState("");
  const [threadStatus, setThreadStatus] = useState<ThreadStatus>("open");
  const [assignedUserId, setAssignedUserId] = useState<string>("");
  const [labelsInput, setLabelsInput] = useState("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) || null,
    [threads, selectedThreadId]
  );

  const filteredThreads = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return threads;
    return threads.filter((thread) => {
      const haystack = `${thread.contact_name || ""} ${thread.contact_phone || ""} ${
        thread.last_message_preview || ""
      }`.toLowerCase();
      return haystack.includes(query);
    });
  }, [threads, search]);

  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(() => setFeedback(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  useEffect(() => {
    if (!selectedThread) return;
    setThreadStatus(selectedThread.status);
    setAssignedUserId(selectedThread.assigned_user_id || "");
    setLabelsInput(buildLabelsInput(selectedThread.labels));
  }, [selectedThread?.id, selectedThread?.status, selectedThread?.assigned_user_id, selectedThread?.labels]);

  const loadIntegration = async () => {
    try {
      const data = await apiRequest<IntegrationStatusPayload>("/api/integrations/evolution/status", accessToken);
      setIntegration(data);
    } catch (error) {
      console.error("Failed to load evolution status", error);
      setIntegration(null);
    }
  };

  const loadMembers = async () => {
    try {
      const data = await apiRequest<ClinicMember[]>("/api/clinic/members", accessToken);
      setMembers((data || []).filter((member) => member.active !== false));
    } catch (error) {
      console.error("Failed to load clinic members", error);
      setMembers([]);
    }
  };

  const loadThreads = async (withLoading = true) => {
    if (withLoading) setLoadingThreads(true);
    try {
      const query = statusFilter === "all" ? "" : `?status=${encodeURIComponent(statusFilter)}`;
      const data = await apiRequest<ThreadListPayload>(`/api/inbox/threads${query}`, accessToken);
      const nextThreads = data.threads || [];
      setThreads(nextThreads);
      setSelectedThreadId((current) => {
        if (current && nextThreads.some((item) => item.id === current)) return current;
        return nextThreads[0]?.id || null;
      });
    } catch (error: unknown) {
      console.error("Failed to load threads", error);
      setThreads([]);
      setFeedback({
        type: "error",
        message: error instanceof ApiError ? error.message : "Falha ao carregar conversas.",
      });
    } finally {
      if (withLoading) setLoadingThreads(false);
    }
  };

  const loadMessages = async (threadId: number, withLoading = true) => {
    if (withLoading) setLoadingMessages(true);
    try {
      const data = await apiRequest<ThreadMessagesPayload>(
        `/api/inbox/threads/${threadId}/messages`,
        accessToken
      );
      setMessages(data.messages || []);
      setThreads((prev) =>
        prev.map((thread) => (thread.id === threadId ? { ...thread, ...data.thread } : thread))
      );
    } catch (error: unknown) {
      console.error("Failed to load thread messages", error);
      setMessages([]);
      setFeedback({
        type: "error",
        message: error instanceof ApiError ? error.message : "Falha ao carregar mensagens.",
      });
    } finally {
      if (withLoading) setLoadingMessages(false);
    }
  };

  const loadAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadIntegration(), loadMembers(), loadThreads(false)]);
      const nextThreadId = selectedThreadId ?? threads[0]?.id ?? null;
      if (nextThreadId) {
        await loadMessages(nextThreadId, false);
      }
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    setLoadingThreads(true);
    Promise.all([loadIntegration(), loadMembers(), loadThreads(false)])
      .catch(() => undefined)
      .finally(() => setLoadingThreads(false));
  }, [accessToken, statusFilter]);

  useEffect(() => {
    if (!selectedThreadId) {
      setMessages([]);
      return;
    }
    void loadMessages(selectedThreadId);
  }, [selectedThreadId, accessToken]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadThreads(false);
      if (selectedThreadId) {
        void loadMessages(selectedThreadId, false);
      }
    }, 20000);
    return () => window.clearInterval(interval);
  }, [selectedThreadId, statusFilter, accessToken]);

  const handleThreadSelect = async (thread: InboxThread) => {
    setSelectedThreadId(thread.id);
    if (thread.unread_count > 0) {
      try {
        const result = await apiRequest<{ success: boolean; thread: InboxThread }>(
          `/api/inbox/threads/${thread.id}/read`,
          accessToken,
          { method: "POST" }
        );
        setThreads((prev) => prev.map((item) => (item.id === thread.id ? result.thread : item)));
      } catch (error) {
        console.error("Failed to mark thread as read", error);
      }
    }
  };

  const handleSaveThread = async () => {
    if (!selectedThread) return;
    setSavingThread(true);
    try {
      const payload = {
        status: threadStatus,
        assigned_user_id: assignedUserId || null,
        labels: labelsInput
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      };
      const data = await apiRequest<{ thread: InboxThread }>(
        `/api/inbox/threads/${selectedThread.id}`,
        accessToken,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        }
      );
      setThreads((prev) => prev.map((thread) => (thread.id === selectedThread.id ? data.thread : thread)));
      setFeedback({ type: "success", message: "Atendimento atualizado." });
    } catch (error: unknown) {
      console.error("Failed to save thread", error);
      setFeedback({
        type: "error",
        message: error instanceof ApiError ? error.message : "Falha ao salvar atendimento.",
      });
    } finally {
      setSavingThread(false);
    }
  };

  const handleSendMessage = async () => {
    if (!selectedThread || !composerText.trim()) return;
    setSendingMessage(true);
    try {
      const data = await apiRequest<{ message: InboxMessage }>(
        `/api/inbox/threads/${selectedThread.id}/messages`,
        accessToken,
        {
          method: "POST",
          body: JSON.stringify({ content: composerText.trim() }),
        }
      );
      setComposerText("");
      setMessages((prev) => [...prev, data.message]);
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === selectedThread.id
            ? {
                ...thread,
                last_message_preview: data.message.content,
                last_message_at: data.message.sent_at,
              }
            : thread
        )
      );
    } catch (error: unknown) {
      console.error("Failed to send message", error);
      setFeedback({
        type: "error",
        message: error instanceof ApiError ? error.message : "Falha ao enviar mensagem.",
      });
    } finally {
      setSendingMessage(false);
    }
  };

  return (
    <div className="space-y-6">
      {feedback && (
        <div
          className={`px-4 py-3 rounded-xl border flex items-start gap-2 ${
            feedback.type === "success"
              ? "bg-success/10 text-success border-success/20"
              : "bg-error/10 text-error border-error/20"
          }`}
        >
          {feedback.type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span className="text-sm font-medium">{feedback.message}</span>
        </div>
      )}

      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Central de Atendimento</h2>
          <p className="text-slate-500">
            Caixa de mensagens por clinica com atribuicao, status e etiquetas.
          </p>
        </div>
        <button
          onClick={() => void loadAll()}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white/80 hover:bg-white transition disabled:opacity-60"
        >
          {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
          Atualizar
        </button>
      </header>

      {integration && (!integration.configured || !integration.connected) && (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 text-[#7a4f06] px-4 py-3 text-sm">
          Integracao Evolution nao esta ativa nesta clinica. Configure em
          {" "}
          <strong>Configuracoes &gt; Integracoes</strong>
          {" "}
          para habilitar envio de mensagens.
        </div>
      )}

      <section className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-6">
        <aside className="glass-panel p-4 space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar conversa..."
                className="apple-input w-full pl-9 py-2"
              />
            </div>
            <select
              className="apple-input py-2 text-sm"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as ThreadStatus | "all")}
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="max-h-[650px] overflow-y-auto space-y-2 pr-1">
            {loadingThreads ? (
              <div className="text-sm text-slate-500 py-6 text-center">Carregando conversas...</div>
            ) : filteredThreads.length === 0 ? (
              <div className="text-sm text-slate-500 py-6 text-center">Nenhuma conversa encontrada.</div>
            ) : (
              filteredThreads.map((thread) => (
                <button
                  key={thread.id}
                  onClick={() => void handleThreadSelect(thread)}
                  className={`w-full text-left rounded-xl border px-3 py-3 transition ${
                    selectedThreadId === thread.id
                      ? "border-petroleum bg-petroleum/10"
                      : "border-slate-200 bg-white/60 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-sm truncate">
                      {thread.contact_name || thread.contact_phone || "Contato sem nome"}
                    </p>
                    {thread.unread_count > 0 && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-petroleum text-white">
                        {thread.unread_count}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1 truncate">{thread.last_message_preview || "-"}</p>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className={`px-2 py-0.5 rounded-full border ${statusBadgeStyles[thread.status]}`}>
                      {statusLabels[thread.status]}
                    </span>
                    <span className="text-slate-400">{formatDateTime(thread.last_message_at)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="glass-panel p-5 flex flex-col min-h-[640px]">
          {!selectedThread ? (
            <div className="flex-1 flex items-center justify-center text-slate-500">
              Selecione uma conversa para visualizar.
            </div>
          ) : (
            <>
              <header className="border-b border-slate-200 pb-4 mb-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-semibold">
                      {selectedThread.contact_name || selectedThread.contact_phone || "Contato"}
                    </h3>
                    <p className="text-sm text-slate-500">{selectedThread.contact_phone || "-"}</p>
                  </div>
                  <button
                    onClick={() => void handleSaveThread()}
                    disabled={savingThread}
                    className="px-4 py-2 rounded-xl bg-petroleum text-white text-sm font-semibold disabled:opacity-60"
                  >
                    {savingThread ? "Salvando..." : "Salvar atendimento"}
                  </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  <label className="text-sm space-y-1">
                    <span className="text-slate-500">Status</span>
                    <select
                      className="apple-input w-full py-2"
                      value={threadStatus}
                      onChange={(event) => setThreadStatus(event.target.value as ThreadStatus)}
                    >
                      {statusOptions
                        .filter((option): option is { value: ThreadStatus; label: string } => option.value !== "all")
                        .map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                    </select>
                  </label>

                  <label className="text-sm space-y-1">
                    <span className="text-slate-500">Responsavel</span>
                    <select
                      className="apple-input w-full py-2"
                      value={assignedUserId}
                      onChange={(event) => setAssignedUserId(event.target.value)}
                    >
                      <option value="">Nao atribuido</option>
                      {members.map((member) => (
                        <option key={member.user_id} value={member.user_id}>
                          {member.full_name || member.email || member.user_id}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-sm space-y-1">
                    <span className="text-slate-500">Etiquetas</span>
                    <div className="relative">
                      <Tag className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                      <input
                        className="apple-input w-full pl-9 py-2"
                        placeholder="novo, retorno, urgente"
                        value={labelsInput}
                        onChange={(event) => setLabelsInput(event.target.value)}
                      />
                    </div>
                  </label>
                </div>
              </header>

              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {loadingMessages ? (
                  <div className="text-sm text-slate-500 py-6 text-center">Carregando mensagens...</div>
                ) : messages.length === 0 ? (
                  <div className="text-sm text-slate-500 py-6 text-center">Sem mensagens nesta conversa.</div>
                ) : (
                  messages.map((message) => {
                    const outbound = message.direction === "outbound";
                    return (
                      <div
                        key={message.id}
                        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                          outbound
                            ? "ml-auto bg-petroleum text-white"
                            : "mr-auto bg-white border border-slate-200 text-slate-700"
                        }`}
                      >
                        <p>{message.content || "-"}</p>
                        <div
                          className={`mt-2 text-[11px] ${
                            outbound ? "text-white/80" : "text-slate-400"
                          } flex items-center gap-2`}
                        >
                          <span>{formatDateTime(message.sent_at)}</span>
                          <span className="uppercase">{message.status}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <footer className="mt-4 border-t border-slate-200 pt-4">
                <div className="flex items-end gap-3">
                  <textarea
                    value={composerText}
                    onChange={(event) => setComposerText(event.target.value)}
                    placeholder="Digite a mensagem..."
                    rows={3}
                    className="apple-input flex-1 resize-none"
                  />
                  <button
                    onClick={() => void handleSendMessage()}
                    disabled={sendingMessage || !composerText.trim()}
                    className="px-4 py-3 rounded-xl bg-success text-white font-semibold disabled:opacity-50 flex items-center gap-2"
                  >
                    {sendingMessage ? <Loader2 size={16} className="animate-spin" /> : <SendHorizonal size={16} />}
                    Enviar
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-500 flex items-center gap-2">
                  <MessageCircle size={14} />
                  Atendimento integrado por Evolution API.
                  <UserRound size={14} className="ml-2" />
                  Atribuicao por membro da clinica.
                </p>
              </footer>
            </>
          )}
        </section>
      </section>
    </div>
  );
};
