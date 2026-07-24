import type { ServerState } from "@minecontrol/shared";
import { useTranslation } from "react-i18next";

/** Bildet jeden Serverstatus auf einen Schlüssel unter `common:status.*` ab. */
const STATUS_KEY: Record<ServerState, string> = {
  ONLINE: "online",
  STARTING: "starting",
  STOPPING: "stopping",
  OFFLINE: "offline",
  ERROR: "error",
  UNKNOWN: "unknown",
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
  const { t } = useTranslation("common");
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
      <StatusDot state={state} />
      {t(`status.${STATUS_KEY[state]}`)}
    </span>
  );
}
