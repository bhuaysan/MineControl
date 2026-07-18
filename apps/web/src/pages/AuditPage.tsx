import type { AuditEntryDto } from "@minecontrol/shared";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { formatRelative } from "../lib/format.js";

export function AuditPage() {
  const { data, isLoading } = useQuery<AuditEntryDto[]>({
    queryKey: ["audit"],
    queryFn: api.listAudit,
  });

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-6 text-2xl font-bold">Audit-Log</h1>
      {isLoading && <p className="text-neutral-500">Lade…</p>}
      <div className="overflow-hidden rounded-lg border border-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-900 text-neutral-400">
            <tr>
              <th className="px-4 py-2 font-medium">Zeit</th>
              <th className="px-4 py-2 font-medium">Benutzer</th>
              <th className="px-4 py-2 font-medium">Aktion</th>
              <th className="px-4 py-2 font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {data?.map((e) => (
              <tr key={e.id} className="hover:bg-neutral-900/50">
                <td className="px-4 py-2 text-neutral-500" title={e.timestamp}>
                  {formatRelative(e.timestamp)}
                </td>
                <td className="px-4 py-2">{e.username}</td>
                <td className="px-4 py-2 font-mono text-xs">{e.action}</td>
                <td className="px-4 py-2 text-neutral-500">
                  {e.serverName ? `${e.serverName} ` : ""}
                  {e.details ? JSON.stringify(e.details) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
