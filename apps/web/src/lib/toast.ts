import i18n from "../i18n/index.js";
import { ApiRequestError } from "./api.js";

export type ToastVariant = "success" | "error" | "info";

export interface Toast {
  id: number;
  variant: ToastVariant;
  message: string;
  title?: string;
}

interface ToastOptions {
  title?: string;
  /** Anzeigedauer in ms; 0 = bleibt bis zum manuellen Schließen. */
  duration?: number;
}

/**
 * Kleiner Toast-Store außerhalb von React. Bewusst store-basiert (nicht nur ein
 * Context), damit auch Code ohne Komponenten-Kontext Toasts auslösen kann — vor
 * allem die globale `MutationCache.onError` des QueryClient (siehe App.tsx), die
 * fehlgeschlagene Mutationen sonst stumm verschluckt. Der {@link Toaster} rendert
 * die aktive Liste.
 */
type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
const listeners = new Set<Listener>();
let nextId = 1;

function emit(): void {
  for (const listener of listeners) listener(toasts);
}

function push(variant: ToastVariant, message: string, opts?: ToastOptions): number {
  const id = nextId++;
  toasts = [...toasts, { id, variant, message, title: opts?.title }];
  emit();
  // Fehler bleiben länger stehen (man will die Ursache lesen können).
  const duration = opts?.duration ?? (variant === "error" ? 8000 : 4000);
  if (duration > 0) setTimeout(() => dismissToast(id), duration);
  return id;
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => {
    listeners.delete(listener);
  };
}

export const toast = {
  success: (message: string, opts?: ToastOptions) => push("success", message, opts),
  error: (message: string, opts?: ToastOptions) => push("error", message, opts),
  info: (message: string, opts?: ToastOptions) => push("info", message, opts),
};

/**
 * Übersetzt einen unbekannten Fehler in eine nutzerlesbare Meldung. Bei einem
 * {@link ApiRequestError} wird die (secret-freie) Server-Meldung genutzt, sonst
 * ein generischer Fallback — nie eine rohe Stack-/Netzwerk-Fehlermeldung.
 */
export function errorMessage(err: unknown, fallback?: string): string {
  const fb = fallback ?? i18n.t("common:errors.actionFailed");
  if (err instanceof ApiRequestError) return err.message || fb;
  if (err instanceof Error && err.message) return err.message;
  return fb;
}
