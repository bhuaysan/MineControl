import type { Capability, ServerStatus } from "@minecontrol/shared";

/**
 * Gemeinsames Interface für alle verwalteten Server (Docker & extern).
 * Das Frontend merkt keinen Unterschied — nur `capabilities()` variiert.
 */
export interface ServerAdapter {
  /** Lifecycle — nicht jeder Adapter kann alles (siehe capabilities). */
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;

  /** Für beide Typen verfügbar. */
  getStatus(): Promise<ServerStatus>;
  sendCommand(cmd: string): Promise<string>;

  /** Welche Fähigkeiten dieser Server aktuell bietet. */
  capabilities(): Capability[];
}

/** Fehler, wenn eine Aktion vom Adapter nicht unterstützt wird. */
export class UnsupportedOperationError extends Error {
  constructor(operation: string) {
    super(`Aktion „${operation}" wird von diesem Servertyp nicht unterstützt`);
    this.name = "UnsupportedOperationError";
  }
}
