import React, { useState } from "react";
import { LogIn, UserPlus } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { Brand } from "./Brand";

type AuthMode = "signin" | "signup" | "forgot" | "update";

interface AuthProps {
  initialMode?: "signin" | "update";
  onPasswordUpdated?: () => void;
}

function resolveInitialMode(initialMode?: "signin" | "update"): AuthMode {
  if (typeof window !== "undefined" && window.location.hash.includes("type=recovery")) {
    return "update";
  }
  return initialMode === "update" ? "update" : "signin";
}

export const Auth = ({ initialMode = "signin", onPasswordUpdated }: AuthProps) => {
  const [mode, setMode] = useState<AuthMode>(() => resolveInitialMode(initialMode));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      if (mode === "signin") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
      } else if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: fullName ? { full_name: fullName } : undefined,
          },
        });
        if (signUpError) throw signUpError;

        if (!data.session) {
          setMessage(
            "Cadastro realizado. Verifique seu email para confirmar a conta antes de entrar."
          );
        }
      } else if (mode === "forgot") {
        const redirectTo =
          typeof window !== "undefined" ? `${window.location.origin}/` : undefined;
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo,
        });
        if (resetError) throw resetError;
        setMessage("Enviamos um link de recuperacao de senha para o seu email.");
      } else if (mode === "update") {
        if (password.length < 6) {
          throw new Error("A nova senha deve ter pelo menos 6 caracteres.");
        }
        if (password !== confirmPassword) {
          throw new Error("As senhas nao conferem.");
        }
        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) throw updateError;
        setMessage("Senha atualizada com sucesso.");
        onPasswordUpdated?.();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Falha ao autenticar.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F8FA] flex items-center justify-center px-4">
      <div className="w-full max-w-md glass-panel p-10 space-y-8">
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <Brand />
          </div>
          <p className="text-slate-500 text-sm">
            {mode === "signin" && "Acesse sua conta para continuar."}
            {mode === "signup" && "Crie sua conta para iniciar."}
            {mode === "forgot" && "Recupere sua senha com link no email."}
            {mode === "update" && "Defina sua nova senha para continuar."}
          </p>
        </div>

        {mode !== "forgot" && mode !== "update" && (
          <div className="flex bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setMode("signin")}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                mode === "signin" ? "bg-white text-petroleum shadow-sm" : "text-slate-500"
              }`}
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                mode === "signup" ? "bg-white text-petroleum shadow-sm" : "text-slate-500"
              }`}
            >
              Criar Conta
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {mode === "signup" && (
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Nome
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="apple-input w-full"
                placeholder="Seu nome"
              />
            </div>
          )}

          {mode !== "update" ? (
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                E-mail
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="apple-input w-full"
                placeholder="voce@exemplo.com"
              />
            </div>
          ) : (
            <div className="text-xs text-slate-500 bg-slate-100 rounded-xl px-3 py-2">
              Link de recuperacao validado. Defina sua nova senha.
            </div>
          )}

          {mode !== "forgot" && (
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                {mode === "update" ? "Nova senha" : "Senha"}
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="apple-input w-full"
                placeholder={mode === "update" ? "Nova senha" : "Sua senha"}
              />
            </div>
          )}

          {mode === "update" && (
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Confirmar senha
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="apple-input w-full"
                placeholder="Repita a nova senha"
              />
            </div>
          )}

          {mode === "signin" && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setMode("forgot");
                  setPassword("");
                  setConfirmPassword("");
                  setError(null);
                  setMessage(null);
                }}
                className="text-xs font-semibold text-petroleum hover:underline"
              >
                Esqueci minha senha
              </button>
            </div>
          )}

          {mode === "forgot" && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setError(null);
                  setMessage(null);
                }}
                className="text-xs font-semibold text-petroleum hover:underline"
              >
                Voltar para entrar
              </button>
            </div>
          )}

          {error && (
            <div className="text-sm text-error bg-error/10 border border-error/20 rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          {message && (
            <div className="text-sm text-success bg-success/10 border border-success/20 rounded-xl px-4 py-3">
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-petroleum text-white py-3 rounded-xl font-semibold shadow-lg shadow-petroleum/20 hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {mode === "signin" ? <LogIn size={18} /> : <UserPlus size={18} />}
            {loading && "Processando..."}
            {!loading && mode === "signin" && "Entrar"}
            {!loading && mode === "signup" && "Criar Conta"}
            {!loading && mode === "forgot" && "Enviar link de recuperacao"}
            {!loading && mode === "update" && "Atualizar senha"}
          </button>
        </form>
      </div>
    </div>
  );
};
