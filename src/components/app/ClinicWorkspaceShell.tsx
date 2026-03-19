import React from "react";
import { Sidebar } from "../Sidebar";
import { Toast } from "../Toast";
import { UserRole } from "../../lib/types";
import { ClinicWorkspaceView } from "../../lib/workspaceRoutes";

type ClinicWorkspaceShellProps = {
  children: React.ReactNode;
  toast: { type: "success" | "error" | "info"; message: string } | null;
  activeView: ClinicWorkspaceView;
  onViewChange: React.Dispatch<React.SetStateAction<ClinicWorkspaceView>>;
  onSignOut: () => Promise<void>;
  userName: string;
  userEmail: string;
  role: UserRole;
  platformRole: "superadmin" | null | undefined;
  activeClinicId?: string;
  activeClinicName?: string | null;
  clinicOptions: Array<{ id: string; label: string }>;
  onClinicChange: (clinicId: string) => void;
  onOpenPlatform: () => void;
};

export const ClinicWorkspaceShell = ({
  children,
  toast,
  activeView,
  onViewChange,
  onSignOut,
  userName,
  userEmail,
  role,
  platformRole,
  activeClinicId,
  activeClinicName,
  clinicOptions,
  onClinicChange,
  onOpenPlatform,
}: ClinicWorkspaceShellProps) => {
  return (
    <div className="flex min-h-screen bg-[#F7F8FA]">
      {toast && <Toast type={toast.type} message={toast.message} />}

      <Sidebar
        activeView={activeView === "patient_profile" ? "patients" : activeView}
        onViewChange={onViewChange}
        onSignOut={onSignOut}
        userName={userName}
        userEmail={userEmail}
        role={role}
        platformRole={platformRole}
        activeClinicId={activeClinicId}
        activeClinicName={activeClinicName}
        clinicOptions={clinicOptions}
        onClinicChange={onClinicChange}
        onOpenPlatform={onOpenPlatform}
      />

      <main className="flex-1 p-8 lg:p-12 overflow-y-auto">
        {children}

        <footer className="mt-12 pt-6 border-t border-black/5 flex flex-col items-center justify-center text-xs text-slate-400">
          <p>
            Smart PSI &copy; {new Date().getFullYear()} - Versao{" "}
            {import.meta.env.VITE_APP_VERSION || "1.0.0"}
          </p>
          <p className="mt-1 opacity-70">
            Ultima atualizacao: {import.meta.env.VITE_APP_BUILD_TIME || "Nao informada"}
          </p>
        </footer>
      </main>
    </div>
  );
};
