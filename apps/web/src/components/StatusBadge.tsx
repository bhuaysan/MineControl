import type { ServerState } from "@minecontrol/shared";

const LABELS: Record<ServerState, string> = {
  ONLINE: "Online",
  STARTING: "Startet",
  STOPPING: "Stoppt",
  OFFLINE: "Offline",
  ERROR: "Fehler",
  UNKNOWN: "Unbekannt",
};

const DOT: Record<ServerState, string> = {
  ONLINE: "bg-status-online",
  STARTING: "bg-status-pending animate-pulse",
  STOPPING: "bg-status-pending animate-pulse",
  OFFLINE: "bg-status-offline",
  ERROR: "bg-status-error",
  UNKNOWN: "bg-status-offline",
};

export function StatusDot({ state }: { state: ServerState }) {
  return <span className={`inline-block size-2.5 rounded-full ${DOT[state]}`} />;
}

export function StatusBadge({ state }: { state: ServerState }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
      <StatusDot state={state} />
      {LABELS[state]}
    </span>
  );
}
