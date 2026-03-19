import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App.tsx";
import { SuperAdminApp } from "./components/SuperAdminApp.tsx";
import { resolveRuntimeSurface } from "./lib/workspaceRoutes.ts";
import "./index.css";

const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
  });
}

const superadminDomains = String(import.meta.env.VITE_SUPERADMIN_DOMAINS || "")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const runtimeSurface =
  typeof window !== "undefined"
    ? resolveRuntimeSurface({
        pathname: window.location.pathname,
        hostname: window.location.hostname,
        search: window.location.search,
        superadminDomains,
      })
    : "app";
const RootComponent = runtimeSurface === "admin" ? SuperAdminApp : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootComponent />
  </StrictMode>,
);
