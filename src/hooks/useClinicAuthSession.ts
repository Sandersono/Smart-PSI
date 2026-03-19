import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { AUTH_EXPIRED_EVENT, setStoredActiveClinicId } from "../lib/api";
import { supabase } from "../lib/supabaseClient";

type ToastType = "success" | "error" | "info";

type UseClinicAuthSessionOptions = {
  notify: (type: ToastType, message: string) => void;
  onSessionInvalidated: () => void;
};

export const useClinicAuthSession = ({
  notify,
  onSessionInvalidated,
}: UseClinicAuthSessionOptions) => {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [forcePasswordReset, setForcePasswordReset] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.location.hash.includes("type=recovery");
  });
  const authExpireInFlightRef = useRef(false);
  const notifyEvent = useEffectEvent(notify);
  const invalidateSessionEvent = useEffectEvent(onSessionInvalidated);

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onAuthExpired = async () => {
      if (authExpireInFlightRef.current) return;
      authExpireInFlightRef.current = true;

      try {
        notifyEvent("error", "Sessao expirada. Faca login novamente.");
        await supabase.auth.signOut();
        setSession(null);
        setStoredActiveClinicId(null);
        invalidateSessionEvent();
      } finally {
        authExpireInFlightRef.current = false;
      }
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthExpired as EventListener);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthExpired as EventListener);
    };
  }, []);

  const refreshSession = async () => {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    return data.session;
  };

  const signOut = async () => {
    setStoredActiveClinicId(null);
    await supabase.auth.signOut();
    setSession(null);
    invalidateSessionEvent();
  };

  const clearPasswordRecovery = () => {
    setForcePasswordReset(false);
    if (typeof window === "undefined") return;
    window.history.replaceState({}, document.title, window.location.pathname);
  };

  return {
    session,
    authReady,
    forcePasswordReset,
    clearPasswordRecovery,
    refreshSession,
    signOut,
  };
};
