import { createServer } from "node:net";

/**
 * Prozessweiter Mutex für „Port frei? → Server-Zeile mit diesem Port anlegen".
 * Ohne ihn können zwei nebenläufige Anfragen (Docker-Server-Anlage,
 * Netzwerk-/Subserver-Anlage — mehrere Call-Sites teilen sich denselben
 * Port-Namensraum) beide denselben Port als frei sehen und beide eine Zeile
 * dafür anlegen (TOCTOU). Reicht, weil der Server als Single Process läuft
 * (SQLite hat ohnehin kein Cross-Statement-Row-Locking) — vgl. `resourceLocks`
 * in networks/service.ts für dasselbe Muster pro Ressourcen-ID.
 */
let chain: Promise<unknown> = Promise.resolve();

export function withPortLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
}

/** Prüft, ob sich ein Socket tatsächlich an `port` (127.0.0.1) binden lässt —
 * ergänzt die DB-Prüfung um die reale Hostbelegung (z. B. durch einen
 * Fremdprozess oder einen Container ohne zugehörige DB-Zeile). */
export function isHostPortBound(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = createServer();
    tester.once("error", () => resolve(true));
    tester.once("listening", () => {
      tester.close(() => resolve(false));
    });
    tester.listen({ port, host: "127.0.0.1", exclusive: true });
  });
}
