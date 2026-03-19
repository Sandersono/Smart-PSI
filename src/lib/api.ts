export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, message: string, payload: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

export const AUTH_EXPIRED_EVENT = "smartpsi:auth-expired";
export const ACTIVE_CLINIC_STORAGE_KEY = "smartpsi:active-clinic-id";

export function getStoredActiveClinicId(): string | null {
  if (typeof window === "undefined") return null;
  const clinicId = window.localStorage.getItem(ACTIVE_CLINIC_STORAGE_KEY);
  return clinicId && clinicId.trim() ? clinicId.trim() : null;
}

export function setStoredActiveClinicId(clinicId: string | null) {
  if (typeof window === "undefined") return;
  if (clinicId && clinicId.trim()) {
    window.localStorage.setItem(ACTIVE_CLINIC_STORAGE_KEY, clinicId.trim());
    return;
  }
  window.localStorage.removeItem(ACTIVE_CLINIC_STORAGE_KEY);
}

export async function apiRequest<T>(
  path: string,
  accessToken: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers ?? {});

  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const activeClinicId = getStoredActiveClinicId();
  const isSuperadminPath = path.startsWith("/api/superadmin");
  if (activeClinicId && !isSuperadminPath && !headers.has("x-clinic-id")) {
    headers.set("x-clinic-id", activeClinicId);
  }

  const response = await fetch(path, {
    ...init,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(AUTH_EXPIRED_EVENT, {
          detail: { status: response.status, path },
        })
      );
    }

    const errorText = await response.text();
    let payload: unknown = null;
    let message = errorText;
    try {
      payload = errorText ? JSON.parse(errorText) : null;
      if (payload && typeof payload === "object" && "error" in payload) {
        message = String((payload as { error?: string }).error || errorText);
      }
    } catch {
      payload = errorText;
    }
    throw new ApiError(response.status, message || `Request failed (${response.status})`, payload);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
