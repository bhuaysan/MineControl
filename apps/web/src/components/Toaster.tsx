import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import type { Toast, ToastVariant } from "../lib/toast.js";
import { dismissToast, subscribeToasts } from "../lib/toast.js";

/** Farb-/Icon-Zuordnung je Variante — konsistent mit dem Status-Farbsystem. */
const VARIANT: Record<ToastVariant, { icon: string; ring: string; accent: string }> = {
  success: { icon: "✓", ring: "border-status-online/40", accent: "text-status-online" },
  error: { icon: "✕", ring: "border-status-error/50", accent: "text-status-error" },
  info: { icon: "ℹ", ring: "border-neutral-600", accent: "text-neutral-300" },
};

function getSnapshot(): Toast[] {
  return currentToasts;
}
let currentToasts: Toast[] = [];
function subscribe(cb: () => void): () => void {
  return subscribeToasts((t) => {
    currentToasts = t;
    cb();
  });
}

/**
 * Rendert die aktiven Toasts oben rechts (über einem Portal, damit sie über
 * jedem Layout liegen). Wird einmal in App gemountet.
 */
export function Toaster(): React.ReactElement | null {
  const { t } = useTranslation("common");
  const toasts = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 z-[100] flex flex-col items-end gap-2 p-4"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((item) => {
        const v = VARIANT[item.variant];
        return (
          <div
            key={item.id}
            role={item.variant === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border ${v.ring} bg-neutral-900/95 px-4 py-3 shadow-lg shadow-black/40 backdrop-blur`}
          >
            <span className={`mt-0.5 text-sm font-bold ${v.accent}`} aria-hidden>
              {v.icon}
            </span>
            <div className="min-w-0 flex-1">
              {item.title && <p className="text-sm font-semibold text-neutral-100">{item.title}</p>}
              <p className="break-words text-sm text-neutral-300">{item.message}</p>
            </div>
            <button
              onClick={() => dismissToast(item.id)}
              className="text-neutral-500 hover:text-neutral-200"
              aria-label={t("actions.close")}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
