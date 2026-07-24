import type { ReactNode } from "react";

/** Kleiner, rotierender Lade-Indikator (SVG statt Emoji für saubere Rotation). */
export function Spinner({ className = "size-5" }: { className?: string }): React.ReactElement {
  return (
    <svg className={`animate-spin text-neutral-400 ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}

/**
 * Einheitlicher Ladezustand für Query-gestützte Listen/Panels. Ersetzt die
 * uneinheitlichen „Lade…"-Textzeilen durch einen konsistenten Spinner + Label.
 */
export function LoadingState({ label = "Lade…" }: { label?: string }): React.ReactElement {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-sm text-neutral-500">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

/**
 * Einheitlicher Fehlerzustand mit optionaler Wiederholen-Aktion (z. B.
 * `query.refetch`). Meldung bewusst kurz und ohne rohe Fehlerdetails.
 */
export function ErrorState({
  message = "Daten konnten nicht geladen werden.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-status-error/30 bg-status-error/5 py-8 text-center">
      <p className="text-sm text-status-error">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
        >
          Erneut versuchen
        </button>
      )}
    </div>
  );
}

/** Einheitlicher Leerzustand für „noch nichts vorhanden". */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-dashed border-neutral-800 p-10 text-center text-neutral-500">
      <p className={hint || action ? "mb-2" : ""}>{title}</p>
      {hint && <p className="mb-2 text-sm text-neutral-600">{hint}</p>}
      {action}
    </div>
  );
}
