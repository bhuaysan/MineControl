import {
  LP_GROUP_NAME_REGEX,
  LP_NODE_REGEX,
  type LpGroupDetailDto,
  type LpNodeDto,
  type LpUserDto,
} from "@minecontrol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { ApiRequestError, api } from "../lib/api.js";
import { confirmDialog } from "../lib/confirm.js";

const inputClass =
  "rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none focus:border-status-online";
const btnPrimary =
  "rounded-md bg-status-online px-3 py-1.5 text-sm font-medium text-neutral-950 hover:brightness-110 disabled:opacity-50";
const btnGhost =
  "rounded-md border border-neutral-700 px-2 py-0.5 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50";

function errMessage(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : "Aktion fehlgeschlagen";
}

export function LuckPermsPanel({ serverId }: { serverId: string }) {
  const { can } = useAuth();
  const isAdmin = can("ADMIN");
  const qc = useQueryClient();
  const [view, setView] = useState<"groups" | "users">("groups");

  const statusKey = ["luckperms", serverId, "status"] as const;
  const { data: status, isLoading } = useQuery({
    queryKey: statusKey,
    queryFn: () => api.lpStatus(serverId),
    refetchInterval: (q) => (q.state.data?.available ? false : 5000),
  });

  const installMut = useMutation({
    mutationFn: () => api.lpInstall(serverId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: statusKey }),
  });

  if (isLoading) return <p className="text-neutral-500">Lade LuckPerms-Status…</p>;
  if (!status?.supported) {
    return (
      <p className="text-sm text-neutral-500">
        Diese Server-Edition unterstützt LuckPerms nicht.
      </p>
    );
  }

  if (!status.installed) {
    return (
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h3 className="mb-2 text-sm font-semibold text-neutral-300">
          LuckPerms nicht installiert
        </h3>
        <p className="mb-3 text-xs text-neutral-500">
          LuckPerms verwaltet feingranulare In-Game-Berechtigungen (Gruppen, Prefixe,
          Rechte). Es wird über Modrinth installiert; danach startet der Server neu.
        </p>
        {isAdmin ? (
          <button
            onClick={() => installMut.mutate()}
            disabled={installMut.isPending}
            className={btnPrimary}
          >
            {installMut.isPending ? "Installiere…" : "LuckPerms installieren"}
          </button>
        ) : (
          <p className="text-xs text-neutral-500">Nur Admins können installieren.</p>
        )}
        {installMut.data && (
          <p className="mt-2 text-sm text-neutral-400">{installMut.data.message}</p>
        )}
        {installMut.isError && (
          <p className="mt-2 text-sm text-status-error">{errMessage(installMut.error)}</p>
        )}
      </section>
    );
  }

  if (!status.available) {
    return (
      <p className="text-sm text-neutral-500">
        LuckPerms ist installiert, antwortet aber noch nicht — der Server muss laufen
        und das Plugin geladen sein.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-neutral-800">
        {(["groups", "users"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors ${
              view === v
                ? "border-status-online text-neutral-100"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {v === "groups" ? "Gruppen" : "Spieler"}
          </button>
        ))}
      </div>
      {view === "groups" ? (
        <GroupsView serverId={serverId} isAdmin={isAdmin} />
      ) : (
        <UsersView serverId={serverId} isAdmin={isAdmin} />
      )}
    </div>
  );
}

// ── Gruppen ──────────────────────────────────────────────────────────────────

function GroupsView({ serverId, isAdmin }: { serverId: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const groupsKey = ["luckperms", serverId, "groups"] as const;

  const { data: groups, isLoading, error } = useQuery({
    queryKey: groupsKey,
    queryFn: () => api.lpListGroups(serverId),
  });

  const createMut = useMutation({
    mutationFn: (name: string) => api.lpCreateGroup(serverId, name),
    onSuccess: () => void qc.invalidateQueries({ queryKey: groupsKey }),
  });
  const deleteMut = useMutation({
    mutationFn: (name: string) => api.lpDeleteGroup(serverId, name),
    onSuccess: (_r, name) => {
      if (selected === name) setSelected(null);
      void qc.invalidateQueries({ queryKey: groupsKey });
    },
  });

  const [newName, setNewName] = useState("");
  const validName = LP_GROUP_NAME_REGEX.test(newName);

  return (
    <div className="space-y-4">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-neutral-300">Gruppen</h3>
        {isLoading && <p className="text-neutral-500">Lade Gruppen…</p>}
        {error && <p className="text-status-error">{errMessage(error)}</p>}
        {groups && groups.length === 0 && (
          <p className="text-sm text-neutral-500">Keine Gruppen.</p>
        )}
        {groups && groups.length > 0 && (
          <ul className="divide-y divide-neutral-800 rounded-lg border border-neutral-800 bg-neutral-900">
            {groups.map((g) => (
              <li
                key={g.name}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <button
                  onClick={() => setSelected(selected === g.name ? null : g.name)}
                  className="flex min-w-0 items-center gap-2 text-left hover:text-status-online"
                >
                  <span className="truncate font-medium text-neutral-100">{g.name}</span>
                  {g.weight != null && (
                    <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
                      weight {g.weight}
                    </span>
                  )}
                </button>
                {isAdmin && g.name !== "default" && (
                  <button
                    onClick={() =>
                      void confirmDialog({
                        title: "Gruppe löschen",
                        message: `Gruppe „${g.name}" löschen?`,
                        confirmLabel: "Löschen",
                        danger: true,
                      }).then((ok) => ok && deleteMut.mutate(g.name))
                    }
                    disabled={deleteMut.isPending}
                    className="text-status-error hover:opacity-80"
                    title="Löschen"
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {deleteMut.isError && (
          <p className="mt-2 text-sm text-status-error">{errMessage(deleteMut.error)}</p>
        )}
      </section>

      {isAdmin && (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            createMut.mutate(newName, { onSuccess: () => setNewName("") });
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <label className="text-sm">
            <span className="mb-1 block text-neutral-400">Neue Gruppe</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value.toLowerCase())}
              placeholder="z. B. moderator"
              className={`${inputClass} ${newName && !validName ? "border-status-error" : ""}`}
            />
          </label>
          <button type="submit" disabled={!validName || createMut.isPending} className={btnPrimary}>
            {createMut.isPending ? "…" : "Anlegen"}
          </button>
          {createMut.isError && (
            <p className="w-full text-sm text-status-error">{errMessage(createMut.error)}</p>
          )}
        </form>
      )}

      {selected && (
        <GroupDetail serverId={serverId} name={selected} isAdmin={isAdmin} />
      )}
    </div>
  );
}

function GroupDetail({
  serverId,
  name,
  isAdmin,
}: {
  serverId: string;
  name: string;
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const key = ["luckperms", serverId, "group", name] as const;
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => api.lpGetGroup(serverId, name),
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: key });

  return (
    <section className="rounded-lg border border-status-online/30 bg-neutral-900 p-4">
      <h3 className="mb-3 text-sm font-semibold text-neutral-100">
        Gruppe „{name}"
      </h3>
      {isLoading && <p className="text-neutral-500">Lade…</p>}
      {error && <p className="text-status-error">{errMessage(error)}</p>}
      {data && (
        <div className="space-y-4">
          {isAdmin ? (
            <MetaForm serverId={serverId} name={name} detail={data} onDone={invalidate} />
          ) : (
            <dl className="grid grid-cols-3 gap-2 text-sm">
              <MetaCell label="Weight" value={data.weight?.toString() ?? "–"} />
              <MetaCell label="Prefix" value={data.prefix ?? "–"} />
              <MetaCell label="Suffix" value={data.suffix ?? "–"} />
            </dl>
          )}
          <PermissionList
            title="Berechtigungen"
            perms={data.permissions}
            isAdmin={isAdmin}
            onSet={(node, value) =>
              api.lpSetGroupPermission(serverId, name, node, value).then(invalidate)
            }
            onUnset={(node) =>
              api.lpUnsetGroupPermission(serverId, name, node).then(invalidate)
            }
          />
        </div>
      )}
    </section>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="truncate text-neutral-200">{value}</dd>
    </div>
  );
}

function MetaForm({
  serverId,
  name,
  detail,
  onDone,
}: {
  serverId: string;
  name: string;
  detail: LpGroupDetailDto;
  onDone: () => void;
}) {
  const [prefix, setPrefix] = useState(detail.prefix ?? "");
  const [suffix, setSuffix] = useState(detail.suffix ?? "");
  const [weight, setWeight] = useState(detail.weight?.toString() ?? "");

  const mut = useMutation({
    mutationFn: () =>
      api.lpSetGroupMeta(serverId, name, {
        prefix: prefix !== (detail.prefix ?? "") ? prefix : undefined,
        suffix: suffix !== (detail.suffix ?? "") ? suffix : undefined,
        weight:
          weight !== (detail.weight?.toString() ?? "") && weight !== ""
            ? Number(weight)
            : undefined,
      }),
    onSuccess: onDone,
  });

  const dirty =
    prefix !== (detail.prefix ?? "") ||
    suffix !== (detail.suffix ?? "") ||
    (weight !== (detail.weight?.toString() ?? "") && weight !== "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mut.mutate();
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <label className="text-sm">
        <span className="mb-1 block text-neutral-400">Prefix</span>
        <input value={prefix} onChange={(e) => setPrefix(e.target.value)} className={inputClass} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-neutral-400">Suffix</span>
        <input value={suffix} onChange={(e) => setSuffix(e.target.value)} className={inputClass} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-neutral-400">Weight</span>
        <input
          type="number"
          min={0}
          max={10000}
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          className={`${inputClass} w-24`}
        />
      </label>
      <button type="submit" disabled={!dirty || mut.isPending} className={btnPrimary}>
        {mut.isPending ? "…" : "Speichern"}
      </button>
      {mut.isError && (
        <p className="w-full text-sm text-status-error">{errMessage(mut.error)}</p>
      )}
    </form>
  );
}

// ── Berechtigungsliste (Gruppe & Spieler geteilt) ─────────────────────────────

function PermissionList({
  title,
  perms,
  isAdmin,
  onSet,
  onUnset,
}: {
  title: string;
  perms: LpNodeDto[];
  isAdmin: boolean;
  onSet: (node: string, value: boolean) => Promise<unknown>;
  onUnset: (node: string) => Promise<unknown>;
}) {
  const [node, setNode] = useState("");
  const [value, setValue] = useState(true);
  const setMut = useMutation({ mutationFn: () => onSet(node.trim(), value) });
  const unsetMut = useMutation({ mutationFn: (n: string) => onUnset(n) });
  const validNode = LP_NODE_REGEX.test(node.trim());

  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {title}
      </h4>
      {perms.length === 0 ? (
        <p className="text-sm text-neutral-500">Keine direkten Berechtigungen.</p>
      ) : (
        <ul className="divide-y divide-neutral-800 rounded-md border border-neutral-800">
          {perms.map((p) => (
            <li
              key={`${p.key}|${p.context ?? ""}`}
              className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
                    p.value
                      ? "bg-status-online/20 text-status-online"
                      : "bg-status-error/20 text-status-error"
                  }`}
                >
                  {p.value ? "true" : "false"}
                </span>
                <span className="min-w-0 truncate font-mono text-neutral-200">{p.key}</span>
                {p.context && (
                  <span className="shrink-0 text-xs text-neutral-500">{p.context}</span>
                )}
              </span>
              {isAdmin && (
                <button
                  onClick={() => unsetMut.mutate(p.key)}
                  disabled={unsetMut.isPending}
                  className="shrink-0 text-status-error hover:opacity-80"
                  title="Entfernen"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {isAdmin && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setMut.mutate(undefined, { onSuccess: () => setNode("") });
          }}
          className="mt-2 flex flex-wrap items-end gap-2"
        >
          <label className="text-sm">
            <span className="mb-1 block text-neutral-400">Node</span>
            <input
              value={node}
              onChange={(e) => setNode(e.target.value)}
              placeholder="z. B. essentials.fly"
              className={`${inputClass} w-64 ${node && !validNode ? "border-status-error" : ""}`}
            />
          </label>
          <select
            value={value ? "true" : "false"}
            onChange={(e) => setValue(e.target.value === "true")}
            className={inputClass}
          >
            <option value="true">true (erlauben)</option>
            <option value="false">false (verweigern)</option>
          </select>
          <button type="submit" disabled={!validNode || setMut.isPending} className={btnGhost}>
            {setMut.isPending ? "…" : "Setzen"}
          </button>
          {(setMut.isError || unsetMut.isError) && (
            <p className="w-full text-sm text-status-error">
              {errMessage(setMut.error ?? unsetMut.error)}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

// ── Spieler ──────────────────────────────────────────────────────────────────

function UsersView({ serverId, isAdmin }: { serverId: string; isAdmin: boolean }) {
  const [name, setName] = useState("");
  const [lookup, setLookup] = useState("");

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setLookup(name.trim());
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <label className="text-sm">
          <span className="mb-1 block text-neutral-400">Spieler</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Spielername"
            className={inputClass}
          />
        </label>
        <button type="submit" disabled={!name.trim()} className={btnPrimary}>
          Suchen
        </button>
      </form>
      <p className="text-xs text-neutral-500">
        Der Spieler muss LuckPerms bekannt sein (bereits verbunden oder online
        auflösbar).
      </p>
      {lookup && <UserDetail serverId={serverId} name={lookup} isAdmin={isAdmin} />}
    </div>
  );
}

function UserDetail({
  serverId,
  name,
  isAdmin,
}: {
  serverId: string;
  name: string;
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const key = ["luckperms", serverId, "user", name] as const;
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => api.lpGetUser(serverId, name),
    retry: false,
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: key });

  if (isLoading) return <p className="text-neutral-500">Lade Spieler…</p>;
  if (error) return <p className="text-status-error">{errMessage(error)}</p>;
  if (!data) return null;

  return (
    <section className="space-y-4 rounded-lg border border-status-online/30 bg-neutral-900 p-4">
      <div>
        <h3 className="text-sm font-semibold text-neutral-100">{data.name}</h3>
        {data.primaryGroup && (
          <p className="text-xs text-neutral-500">
            Primäre Gruppe: <span className="text-neutral-300">{data.primaryGroup}</span>
          </p>
        )}
      </div>
      <UserGroups serverId={serverId} user={data} isAdmin={isAdmin} onDone={invalidate} />
      <PermissionList
        title="Direkte Berechtigungen"
        perms={data.permissions}
        isAdmin={isAdmin}
        onSet={(node, value) =>
          api.lpSetUserPermission(serverId, name, node, value).then(invalidate)
        }
        onUnset={(node) => api.lpUnsetUserPermission(serverId, name, node).then(invalidate)}
      />
    </section>
  );
}

function UserGroups({
  serverId,
  user,
  isAdmin,
  onDone,
}: {
  serverId: string;
  user: LpUserDto;
  isAdmin: boolean;
  onDone: () => void;
}) {
  const [group, setGroup] = useState("");
  const addMut = useMutation({
    mutationFn: () => api.lpAddUserGroup(serverId, user.name, group.trim()),
    onSuccess: () => {
      setGroup("");
      onDone();
    },
  });
  const removeMut = useMutation({
    mutationFn: (g: string) => api.lpRemoveUserGroup(serverId, user.name, g),
    onSuccess: onDone,
  });
  const valid = LP_GROUP_NAME_REGEX.test(group.trim());

  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Gruppen
      </h4>
      {user.groups.length === 0 ? (
        <p className="text-sm text-neutral-500">Keine Gruppen.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {user.groups.map((g) => (
            <li
              key={g}
              className="flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm"
            >
              <span className="text-neutral-200">{g}</span>
              {isAdmin && (
                <button
                  onClick={() => removeMut.mutate(g)}
                  disabled={removeMut.isPending}
                  className="text-status-error hover:opacity-80"
                  title="Entfernen"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {isAdmin && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addMut.mutate();
          }}
          className="mt-2 flex flex-wrap items-end gap-2"
        >
          <input
            value={group}
            onChange={(e) => setGroup(e.target.value.toLowerCase())}
            placeholder="Gruppe hinzufügen"
            className={`${inputClass} ${group && !valid ? "border-status-error" : ""}`}
          />
          <button type="submit" disabled={!valid || addMut.isPending} className={btnGhost}>
            {addMut.isPending ? "…" : "Hinzufügen"}
          </button>
          {(addMut.isError || removeMut.isError) && (
            <p className="w-full text-sm text-status-error">
              {errMessage(addMut.error ?? removeMut.error)}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
