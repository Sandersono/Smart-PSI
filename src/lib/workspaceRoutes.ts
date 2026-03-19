export const APP_PATH_PREFIX = "/app";
export const ADMIN_PATH_PREFIX = "/admin";

export const clinicWorkspaceViews = [
  "dashboard",
  "record",
  "note",
  "settings",
  "help",
  "patients",
  "patient_profile",
  "agenda",
  "inbox",
  "financial",
] as const;

export type ClinicWorkspaceView = (typeof clinicWorkspaceViews)[number];
export type RuntimeSurface = "app" | "admin";

const clinicWorkspaceViewSet = new Set<ClinicWorkspaceView>(clinicWorkspaceViews);

const normalizePathname = (pathname: string) => {
  if (!pathname) return "/";
  const normalized = pathname.replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : "/";
};

export const isAdminPath = (pathname: string) => {
  const normalized = normalizePathname(pathname);
  return normalized === ADMIN_PATH_PREFIX || normalized.startsWith(`${ADMIN_PATH_PREFIX}/`);
};

export const isAppPath = (pathname: string) => {
  const normalized = normalizePathname(pathname);
  return normalized === APP_PATH_PREFIX || normalized.startsWith(`${APP_PATH_PREFIX}/`);
};

export const buildClinicWorkspacePath = (view: ClinicWorkspaceView) => `${APP_PATH_PREFIX}/${view}`;

export const parseClinicWorkspaceView = (
  pathname: string,
  fallback: ClinicWorkspaceView
): ClinicWorkspaceView => {
  const normalized = normalizePathname(pathname);
  if (!isAppPath(normalized)) return fallback;

  const [, maybeView] = normalized.split("/");
  const view = maybeView === "app" ? normalized.split("/")[2] : maybeView;
  return clinicWorkspaceViewSet.has(view as ClinicWorkspaceView)
    ? (view as ClinicWorkspaceView)
    : fallback;
};

export const resolveRuntimeSurface = ({
  pathname,
  hostname,
  search,
  superadminDomains,
}: {
  pathname: string;
  hostname: string;
  search: string;
  superadminDomains: string[];
}): RuntimeSurface => {
  if (isAdminPath(pathname)) return "admin";
  if (isAppPath(pathname)) return "app";

  const currentHostname = hostname.trim().toLowerCase();
  const forceSuperadmin = new URLSearchParams(search).get("superadmin") === "1";
  return forceSuperadmin || (currentHostname ? superadminDomains.includes(currentHostname) : false)
    ? "admin"
    : "app";
};

export const syncBrowserPath = (nextPath: string, mode: "push" | "replace" = "replace") => {
  if (typeof window === "undefined") return;

  const currentPath = normalizePathname(window.location.pathname);
  const targetPath = normalizePathname(nextPath);
  if (currentPath === targetPath) return;

  const nextUrl = `${targetPath}${window.location.search}${window.location.hash}`;
  if (mode === "push") {
    window.history.pushState({}, document.title, nextUrl);
    return;
  }

  window.history.replaceState({}, document.title, nextUrl);
};
