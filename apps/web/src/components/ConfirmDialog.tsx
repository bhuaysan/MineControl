import { useEffect, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import type { ConfirmRequest } from "../lib/confirm.js";
import { resolveConfirm, subscribeConfirm } from "../lib/confirm.js";

let currentRequest: ConfirmRequest | null = null;
function subscribe(cb: () => void): () => void {
  return subscribeConfirm((req) => {
    currentRequest = req;
    cb();
  });
}
function getSnapshot(): ConfirmRequest | null {
  return currentRequest;
}

/**
 * Gestylter Bestätigungsdialog als Ersatz für das native `confirm()`. Einmal in
 * App gemountet; zeigt die jeweils offene {@link confirmDialog}-Anfrage. Enter
 * bestätigt, Escape/Backdrop bricht ab.
 */
export function ConfirmDialog(): React.ReactElement | null {
  const { t } = useTranslation("dialog");
  const request = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") resolveConfirm(false);
      else if (e.key === "Enter") resolveConfirm(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request]);

  if (!request || typeof document === "undefined") return null;

  const {
    title = t("defaultTitle"),
    message,
    confirmLabel = t("common:actions.confirm"),
    cancelLabel = t("common:actions.cancel"),
    danger = false,
  } = request;

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4"
      onClick={() => resolveConfirm(false)}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 text-lg font-semibold text-neutral-100">{title}</h2>
        <p className="mb-5 whitespace-pre-line text-sm text-neutral-300">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => resolveConfirm(false)}
            className="rounded-md border border-neutral-700 px-4 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
          >
            {cancelLabel}
          </button>
          <button
            autoFocus
            onClick={() => resolveConfirm(true)}
            className={
              danger
                ? "rounded-md bg-status-error px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
                : "rounded-md bg-status-online px-4 py-1.5 text-sm font-medium text-neutral-950 hover:opacity-90"
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
