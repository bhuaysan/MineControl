import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { ServerCard } from "../components/ServerCard.js";
import { useDashboardSocket } from "../hooks/useDashboardSocket.js";
import { useServers } from "../hooks/useServers.js";

export function DashboardPage() {
  const { can } = useAuth();
  const { data: servers, isLoading, error } = useServers();
  const wsState = useDashboardSocket();

  const online = servers?.filter((s) => s.status.online).length ?? 0;
  const totalPlayers =
    servers?.reduce((sum, s) => sum + s.status.players.online, 0) ?? 0;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        {can("ADMIN") && (
          <Link
            to="/servers/new"
            className="rounded-md bg-status-online px-3 py-2 text-sm font-medium text-neutral-950 hover:opacity-90"
          >
            + Server hinzufügen
          </Link>
        )}
      </div>

      {wsState === "closed" && (
        <div className="mb-4 rounded-md border border-status-pending/40 bg-status-pending/10 px-4 py-2 text-sm text-status-pending">
          Live-Verbindung getrennt – versuche erneut…
        </div>
      )}

      {servers && servers.length > 0 && (
        <div className="mb-6 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-neutral-300">
          <span className="font-semibold text-neutral-100">
            {online}/{servers.length}
          </span>{" "}
          Server online · <span className="font-semibold">{totalPlayers}</span> Spieler
        </div>
      )}

      {isLoading && <p className="text-neutral-500">Lade Server…</p>}
      {error && <p className="text-status-error">Server konnten nicht geladen werden.</p>}

      {servers && servers.length === 0 && (
        <div className="rounded-lg border border-dashed border-neutral-800 p-10 text-center text-neutral-500">
          <p className="mb-2">Noch keine Server eingerichtet.</p>
          {can("ADMIN") && (
            <Link to="/servers/new" className="text-status-online hover:underline">
              Ersten Server hinzufügen
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {servers?.map((s) => <ServerCard key={s.id} server={s} />)}
      </div>
    </div>
  );
}
