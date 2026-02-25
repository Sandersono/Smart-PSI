import React from "react";
import { CheckCircle2, AlertCircle, Info } from "lucide-react";

type ToastType = "success" | "error" | "info";

interface ToastProps {
  type: ToastType;
  message: string;
}

export const Toast = ({ type, message }: ToastProps) => {
  const config =
    type === "success"
      ? {
          icon: CheckCircle2,
          className: "bg-success text-white border-success/30",
        }
      : type === "error"
      ? {
          icon: AlertCircle,
          className: "bg-error text-white border-error/30",
        }
      : {
          icon: Info,
          className: "bg-petroleum text-white border-petroleum/30",
        };

  const Icon = config.icon;

  return (
    <div
      className={`fixed top-5 right-5 z-[200] max-w-sm px-4 py-3 rounded-xl shadow-xl border backdrop-blur-md flex items-start gap-3 ${config.className}`}
      role="status"
      aria-live="polite"
    >
      <Icon size={18} className="shrink-0 mt-0.5" />
      <p className="text-sm font-medium leading-relaxed">{message}</p>
    </div>
  );
};
