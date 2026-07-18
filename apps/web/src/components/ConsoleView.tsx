import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api } from "../lib/api.js";
import { openTopicSocket } from "../lib/ws.js";

/** Terminal-Theme passend zur neutralen Dark-UI. */
const THEME = {
  background: "#0a0a0a",
  foreground: "#d4d4d4",
  cursor: "#4ade80",
  selectionBackground: "#264f78",
};

/**
 * Live-Konsole eines Docker-Servers: xterm.js-Terminal mit Log-Stream
 * (`console:<id>`-Abo) und optionaler Befehlseingabe (via RCON).
 */
export function ConsoleView({
  serverId,
  canInput,
}: {
  serverId: string;
  canInput: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [connected, setConnected] = useState(false);

  const [command, setCommand] = useState("");
  const history = useRef<string[]>([]);
  const historyPos = useRef<number>(-1);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 12,
      convertEol: true,
      scrollback: 5000,
      theme: THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;

    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* Container evtl. gerade unsichtbar */
      }
    });
    resizeObserver.observe(host);

    const closeSocket = openTopicSocket(
      `console:${serverId}`,
      (msg) => {
        if (msg.type === "console.line" && msg.serverId === serverId) {
          term.writeln(msg.line);
        }
      },
      setConnected,
    );

    return () => {
      closeSocket();
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, [serverId]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cmd = command.trim();
    const term = termRef.current;
    if (!cmd || !term) return;
    history.current.push(cmd);
    historyPos.current = history.current.length;
    setCommand("");
    setSending(true);
    term.writeln(`\x1b[36m> ${cmd}\x1b[0m`);
    try {
      const res = await api.sendCommand(serverId, cmd);
      if (res.response.trim()) {
        for (const line of res.response.split("\n")) term.writeln(line);
      }
    } catch (err) {
      term.writeln(`\x1b[31mFehler: ${(err as Error).message}\x1b[0m`);
    } finally {
      setSending(false);
    }
  };

  // Befehls-Historie mit ↑/↓.
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (historyPos.current > 0) {
        historyPos.current -= 1;
        setCommand(history.current[historyPos.current] ?? "");
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyPos.current < history.current.length - 1) {
        historyPos.current += 1;
        setCommand(history.current[historyPos.current] ?? "");
      } else {
        historyPos.current = history.current.length;
        setCommand("");
      }
    }
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-neutral-800 bg-[#0a0a0a]">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-1.5 text-xs text-neutral-500">
        <span>Konsole</span>
        <span className="flex items-center gap-1.5">
          <span
            className={`inline-block size-2 rounded-full ${
              connected ? "bg-status-online" : "bg-status-offline"
            }`}
          />
          {connected ? "live" : "getrennt"}
        </span>
      </div>
      <div ref={hostRef} className="h-[420px] w-full px-2 py-1" />
      {canInput && (
        <form
          onSubmit={onSubmit}
          className="flex items-center gap-2 border-t border-neutral-800 px-2 py-2"
        >
          <span className="pl-1 text-neutral-600">/</span>
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Befehl (z. B. say Hallo)"
            className="min-w-0 flex-1 bg-transparent font-mono text-sm text-neutral-200 outline-none placeholder:text-neutral-600"
          />
          <button
            type="submit"
            disabled={sending}
            className="rounded-md bg-status-online px-3 py-1 text-sm font-medium text-neutral-950 hover:opacity-90 disabled:opacity-50"
          >
            Senden
          </button>
        </form>
      )}
    </div>
  );
}
