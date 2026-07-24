import type { Role, UserDto } from "@minecontrol/shared";
import { ROLES } from "@minecontrol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { api } from "../lib/api.js";
import { confirmDialog } from "../lib/confirm.js";
import { formatRelative } from "../lib/format.js";

const usersKey = ["users"] as const;

const ROLE_LABEL: Record<Role, string> = {
  VIEWER: "Viewer",
  MODERATOR: "Moderator",
  ADMIN: "Admin",
};

export function UsersPage() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const { data: users, isLoading } = useQuery<UserDto[]>({
    queryKey: usersKey,
    queryFn: api.listUsers,
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: usersKey });

  const [error, setError] = useState<string | null>(null);
  const handleError = (err: unknown) => setError((err as Error).message);

  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("VIEWER");

  const createMutation = useMutation({
    mutationFn: () =>
      api.createUser({ username: newName, password: newPassword, role: newRole }),
    onSuccess: () => {
      setNewName("");
      setNewPassword("");
      setNewRole("VIEWER");
      setError(null);
      invalidate();
    },
    onError: handleError,
  });

  const roleMutation = useMutation({
    mutationFn: (v: { id: string; role: Role }) =>
      api.updateUser(v.id, { role: v.role }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: handleError,
  });

  const passwordMutation = useMutation({
    mutationFn: (v: { id: string; password: string }) =>
      api.updateUser(v.id, { password: v.password }),
    onSuccess: () => setError(null),
    onError: handleError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteUser(id),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: handleError,
  });

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    createMutation.mutate();
  };

  const onResetPassword = (u: UserDto) => {
    const pw = prompt(`Neues Passwort für „${u.username}" (mind. 8 Zeichen):`);
    if (pw) passwordMutation.mutate({ id: u.id, password: pw });
  };

  const onDelete = async (u: UserDto) => {
    const ok = await confirmDialog({
      title: "Benutzer löschen",
      message: `Benutzer „${u.username}" wirklich löschen?`,
      confirmLabel: "Löschen",
      danger: true,
    });
    if (ok) deleteMutation.mutate(u.id);
  };

  const inputClass =
    "rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-status-online";

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-6 text-2xl font-bold">Benutzerverwaltung</h1>

      {error && (
        <div className="mb-4 rounded-md border border-status-error/40 bg-status-error/10 px-4 py-2 text-sm text-status-error">
          {error}
        </div>
      )}

      <form
        onSubmit={onCreate}
        className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4"
      >
        <div className="flex flex-col">
          <label className="mb-1 text-xs text-neutral-500">Benutzername</label>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
            className={inputClass}
            placeholder="z. B. moritz"
          />
        </div>
        <div className="flex flex-col">
          <label className="mb-1 text-xs text-neutral-500">Passwort</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            className={inputClass}
            placeholder="mind. 8 Zeichen"
          />
        </div>
        <div className="flex flex-col">
          <label className="mb-1 text-xs text-neutral-500">Rolle</label>
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as Role)}
            className={inputClass}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded-md bg-status-online px-4 py-2 text-sm font-medium text-neutral-950 hover:opacity-90 disabled:opacity-50"
        >
          Anlegen
        </button>
      </form>

      {isLoading && <p className="text-neutral-500">Lade…</p>}

      <div className="overflow-hidden rounded-lg border border-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-900 text-neutral-400">
            <tr>
              <th className="px-4 py-2 font-medium">Benutzer</th>
              <th className="px-4 py-2 font-medium">Rolle</th>
              <th className="px-4 py-2 font-medium">Angelegt</th>
              <th className="px-4 py-2 font-medium text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {users?.map((u) => {
              const isSelf = u.id === me?.id;
              return (
                <tr key={u.id} className="hover:bg-neutral-900/50">
                  <td className="px-4 py-2">
                    {u.username}
                    {isSelf && (
                      <span className="ml-2 text-xs text-neutral-600">(Sie)</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={u.role}
                      onChange={(e) =>
                        roleMutation.mutate({ id: u.id, role: e.target.value as Role })
                      }
                      className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm outline-none focus:border-status-online"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2 text-neutral-500" title={u.createdAt}>
                    {formatRelative(u.createdAt)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => onResetPassword(u)}
                      className="rounded px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                    >
                      Passwort
                    </button>
                    <button
                      onClick={() => void onDelete(u)}
                      disabled={isSelf}
                      className="rounded px-2 py-1 text-status-error hover:bg-status-error/10 disabled:opacity-30"
                      title={isSelf ? "Man kann sich nicht selbst löschen" : "Löschen"}
                    >
                      Löschen
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
