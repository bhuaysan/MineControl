import type { PlayerAction } from "@minecontrol/shared";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api.js";

interface Props {
  serverId: string;
  playerName: string;
  /** Wird nach erfolgreicher Aktion aufgerufen (z. B. Liste neu laden). */
  onDone?: () => void;
}

interface MenuItem {
  action: PlayerAction;
  label: string;
  /** Öffnet vorher einen Grund-Dialog. */
  needsReason?: "required" | "optional";
  destructive?: boolean;
}

const ITEMS: MenuItem[] = [
  { action: "kick", label: "Kicken", needsReason: "optional", destructive: true },
  { action: "ban", label: "Bannen", needsReason: "required", destructive: true },
  { action: "unban", label: "Entbannen" },
  { action: "whitelist_add", label: "Whitelist +" },
  { action: "whitelist_remove", label: "Whitelist −" },
  { action: "op", label: "OP geben" },
  { action: "deop", label: "OP entziehen" },
];

export function PlayerActionMenu({ serverId, playerName, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<MenuItem | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (vars: { action: PlayerAction; reason?: string }) =>
      api.playerAction(serverId, {
        name: playerName,
        action: vars.action,
        reason: vars.reason || undefined,
      }),
    onSuccess: () => {
      setDialog(null);
      setReason("");
      setError(null);
      onDone?.();
    },
    onError: (err) => setError((err as Error).message),
  });

  const onSelect = (item: MenuItem) => {
    setOpen(false);
    setError(null);
    if (item.needsReason) {
      setReason("");
      setDialog(item);
    } else {
      mutation.mutate({ action: item.action });
    }
  };

  const confirmDialog = () => {
    if (!dialog) return;
    if (dialog.needsReason === "required" && !reason.trim()) {
      setError("Bitte einen Grund angeben.");
      return;
    }
    mutation.mutate({ action: dialog.action, reason: reason.trim() });
  };

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded px-2 py-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          aria-label={`Aktionen für ${playerName}`}
        >
          ⋮
        </button>
        {open && (
          <>
            <button
              className="fixed inset-0 z-10 cursor-default"
              onClick={() => setOpen(false)}
              aria-hidden
            />
            <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-md border border-neutral-700 bg-neutral-800 py-1 shadow-lg">
              {ITEMS.map((item) => (
                <button
                  key={item.action}
                  onClick={() => onSelect(item)}
                  className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-700 ${
                    item.destructive ? "text-status-error" : "text-neutral-200"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {dialog && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg border border-neutral-700 bg-neutral-900 p-5">
            <h3 className="mb-3 font-semibold">
              {dialog.label}: <span className="text-neutral-300">{playerName}</span>
            </h3>
            <label className="mb-1 block text-sm text-neutral-400">
              Grund {dialog.needsReason === "required" ? "(Pflicht)" : "(optional)"}
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              autoFocus
              className="mb-2 w-full resize-none rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-status-online"
            />
            {error && <p className="mb-2 text-sm text-status-error">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setDialog(null);
                  setError(null);
                }}
                className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200"
              >
                Abbrechen
              </button>
              <button
                onClick={confirmDialog}
                disabled={mutation.isPending}
                className="rounded-md bg-status-error px-3 py-1.5 text-sm font-medium text-neutral-950 hover:opacity-90 disabled:opacity-50"
              >
                {mutation.isPending ? "…" : dialog.label}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
