import { useEffect, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { ApiError, apiRequest, setStoredActiveClinicId } from "../lib/api";
import { SessionContext } from "../lib/types";

export const useClinicSessionContext = (session: Session | null) => {
  const [sessionContext, setSessionContext] = useState<SessionContext | null>(null);
  const [sessionContextError, setSessionContextError] = useState<string | null>(null);
  const [loadingSessionContext, setLoadingSessionContext] = useState(false);

  const refreshSessionContext = async (accessTokenOverride?: string) => {
    const accessToken = accessTokenOverride || session?.access_token;
    if (!accessToken) {
      setSessionContext(null);
      setSessionContextError(null);
      setLoadingSessionContext(false);
      return null;
    }

    setLoadingSessionContext(true);
    setSessionContextError(null);

    try {
      const data = await apiRequest<SessionContext>("/api/session/context", accessToken);
      setSessionContext(data);
      setStoredActiveClinicId(data.active_membership.clinic_id);
      return data;
    } catch (error) {
      console.error("Failed to load user context", error);
      if (error instanceof ApiError) {
        setSessionContextError(error.message || "Falha ao carregar contexto da clinica.");
      } else {
        setSessionContextError("Falha ao carregar contexto da clinica.");
      }
      setSessionContext(null);
      return null;
    } finally {
      setLoadingSessionContext(false);
    }
  };

  useEffect(() => {
    if (!session) {
      setSessionContext(null);
      setSessionContextError(null);
      setLoadingSessionContext(false);
      return;
    }

    void refreshSessionContext(session.access_token);
  }, [session?.access_token]);

  return {
    sessionContext,
    sessionContextError,
    loadingSessionContext,
    refreshSessionContext,
  };
};
