import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App.tsx";
import { SuperAdminApp } from "./components/SuperAdminApp.tsx";
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
const currentHostname =
  typeof window !== "undefined" ? window.location.hostname.toLowerCase() : "";
const forceSuperadmin =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("superadmin") === "1";
const runAsSuperadmin =
  forceSuperadmin || (currentHostname ? superadminDomains.includes(currentHostname) : false);
const RootComponent = runAsSuperadmin ? SuperAdminApp : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootComponent />
  </StrictMode>,
);
