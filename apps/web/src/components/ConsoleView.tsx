import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api.js";
import { openTopicSocket } from "../lib/ws.js";

/** Terminal-Theme passend zur neutralen Dark-UI. */
const THEME = {
  background: "#0a0a0a",
  foreground: "#d4d4d4",
  cursor: "#4ade80",
  selectionBackground: "#264f78",
};

/** Hervorhebung der Suchtreffer im Terminal. */
const SEARCH_DECORATIONS = {
  matchBackground: "#ca8a04",
  matchOverviewRuler: "#ca8a04",
  activeMatchBackground: "#4ade80",
  activeMatchColorOverviewRuler: "#4ade80",
};

/**
 * Live-Konsole eines Docker-Servers: xterm.js-Terminal mit Log-Stream
 * (`console:<id>`-Abo) und optionaler Befehlseingabe (via RCON). xterm rendert
 * ANSI-Farben nativ und scrollt neue Zeilen automatisch mit, solange man unten
 * steht. Zusätzlich: Volltextsuche im Puffer und ein „nach unten"-Knopf, sobald
 * man hochgescrollt hat (dann pausiert das Auto-Scroll bewusst).
 */
export function ConsoleView({ serverId, canInput }: { serverId: string; canInput: boolean }) {
  const { t } = useTranslation("console");
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const [connected, setConnected] = useState(false);
  const [atBottom, setAtBottom] = useState(true);

  const [search, setSearch] = useState("");
  const [command, setCommand] = useState("");
  const history = useRef<string[]>([]);
  const historyPos = useRef<number>(-1);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 12,
      convertEol: true,
      scrollback: 5000,
      theme: THEME,
    });
    const fit = new FitAddon();
    const searchAddon = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(searchAddon);
    term.open(host);
    fit.fit();
    termRef.current = term;
    searchRef.current = searchAddon;

    // „Unten"-Zustand verfolgen: Steht der Viewport auf der jüngsten Zeile, gilt
    // Auto-Scroll; sonst zeigen wir den „nach unten"-Knopf und stören das Lesen
    // im Verlauf nicht.
    const updateAtBottom = () => {
      const buffer = term.buffer.active;
      setAtBottom(buffer.viewportY >= buffer.baseY);
    };
    const scrollSub = term.onScroll(updateAtBottom);

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
      scrollSub.dispose();
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      searchRef.current = null;
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
      term.writeln(`\x1b[31m${t("error", { message: (err as Error).message })}\x1b[0m`);
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

  const findNext = () => searchRef.current?.findNext(search, { decorations: SEARCH_DECORATIONS });
  const findPrevious = () =>
    searchRef.current?.findPrevious(search, { decorations: SEARCH_DECORATIONS });

  // Enter = nächster Treffer, Shift+Enter = vorheriger.
  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) findPrevious();
      else findNext();
    } else if (e.key === "Escape") {
      setSearch("");
      searchRef.current?.clearDecorations();
    }
  };

  const scrollToBottom = () => termRef.current?.scrollToBottom();

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-neutral-800 bg-[#0a0a0a]">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-3 py-1.5 text-xs text-neutral-500">
        <span className="shrink-0">{t("title")}</span>
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (!e.target.value) searchRef.current?.clearDecorations();
            }}
            onKeyDown={onSearchKeyDown}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchAriaLabel")}
            className="min-w-0 flex-1 rounded bg-neutral-900 px-2 py-1 text-xs text-neutral-200 outline-none placeholder:text-neutral-600 focus:ring-1 focus:ring-neutral-700"
          />
          <button
            type="button"
            onClick={findPrevious}
            disabled={!search}
            className="rounded px-1.5 py-1 hover:bg-neutral-800 disabled:opacity-40"
            title={t("prevMatch")}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={findNext}
            disabled={!search}
            className="rounded px-1.5 py-1 hover:bg-neutral-800 disabled:opacity-40"
            title={t("nextMatch")}
          >
            ↓
          </button>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <span
            className={`inline-block size-2 rounded-full ${
              connected ? "bg-status-online" : "bg-status-offline"
            }`}
          />
          {connected ? t("live") : t("disconnected")}
        </span>
      </div>
      <div className="relative">
        <div ref={hostRef} className="h-[420px] w-full px-2 py-1" />
        {!atBottom && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 right-4 rounded-full border border-neutral-700 bg-neutral-900/90 px-3 py-1 text-xs text-neutral-200 shadow-lg hover:bg-neutral-800"
            title={t("jumpToEnd")}
          >
            ↓ {t("newest")}
          </button>
        )}
      </div>
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
            placeholder={t("commandPlaceholder")}
            className="min-w-0 flex-1 bg-transparent font-mono text-sm text-neutral-200 outline-none placeholder:text-neutral-600"
          />
          <button
            type="submit"
            disabled={sending}
            className="rounded-md bg-status-online px-3 py-1 text-sm font-medium text-neutral-950 hover:opacity-90 disabled:opacity-50"
          >
            {t("send")}
          </button>
        </form>
      )}
    </div>
  );
}
