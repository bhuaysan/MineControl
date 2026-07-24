export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Hebt die Bestätigen-Schaltfläche als destruktiv (rot) hervor. */
  danger?: boolean;
}

export interface ConfirmRequest extends ConfirmOptions {
  id: number;
  resolve: (ok: boolean) => void;
}

/**
 * Store für den gestylten Bestätigungsdialog. Ersetzt das native, blockierende
 * `confirm()` durch einen versprochenen (Promise-basierten) Dialog: Aufrufer
 * schreiben `if (await confirmDialog({ … }))`. Der {@link ConfirmDialog}-Host
 * rendert die jeweils offene Anfrage.
 */
type Listener = (request: ConfirmRequest | null) => void;

let current: ConfirmRequest | null = null;
const listeners = new Set<Listener>();
let nextId = 1;

function emit(): void {
  for (const listener of listeners) listener(current);
}

/** Öffnet den Dialog und löst mit `true` (bestätigt) oder `false` (abgebrochen). */
export function confirmDialog(options: ConfirmOptions | string): Promise<boolean> {
  const opts = typeof options === "string" ? { message: options } : options;
  return new Promise<boolean>((resolve) => {
    // Nur ein Dialog gleichzeitig: eine bereits offene Anfrage abbrechen.
    if (current) current.resolve(false);
    current = { id: nextId++, ...opts, resolve };
    emit();
  });
}

/** Schließt den aktiven Dialog mit dem gegebenen Ergebnis. */
export function resolveConfirm(ok: boolean): void {
  if (!current) return;
  current.resolve(ok);
  current = null;
  emit();
}

export function subscribeConfirm(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
