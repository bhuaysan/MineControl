import type { ServerDto } from "@minecontrol/shared";
import { Link } from "react-router-dom";
import { StatusBadge } from "./StatusBadge.js";

const STATE_BORDER: Record<string, string> = {
  ONLINE: "border-l-status-online",
  STARTING: "border-l-status-pending",
  STOPPING: "border-l-status-pending",
  OFFLINE: "border-l-status-offline",
  ERROR: "border-l-status-error",
  UNKNOWN: "border-l-status-offline",
};

export function ServerCard({ server }: { server: ServerDto }) {
  const { status } = server;
  return (
    <Link
      to={`/servers/${server.id}`}
      className={`block rounded-lg border border-neutral-800 border-l-4 bg-neutral-900 p-4 transition-colors hover:border-neutral-700 hover:bg-neutral-800/60 ${
        STATE_BORDER[status.state] ?? STATE_BORDER.UNKNOWN
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-neutral-100">{server.name}</h3>
          <p className="text-xs text-neutral-400">
            {status.version ?? server.edition} ·{" "}
            {server.type === "DOCKER" ? "Docker" : "Extern"}
          </p>
        </div>
        <StatusBadge state={status.state} />
      </div>

      <div className="mt-3 flex items-center gap-4 text-sm text-neutral-300">
        <span title="Spieler online">
          👥 {status.players.online}
          {status.players.max ? `/${status.players.max}` : ""}
        </span>
        <span className="truncate text-neutral-500">{server.host}:{server.port}</span>
      </div>

      {status.motd && (
        <p className="mt-2 line-clamp-1 text-xs text-neutral-500">{status.motd}</p>
      )}
    </Link>
  );
}
