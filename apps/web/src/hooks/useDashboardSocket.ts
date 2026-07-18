import type { ServerDto, ServerMessage } from "@minecontrol/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { serversQueryKey } from "./useServers.js";

type ConnState = "connecting" | "open" | "closed";

/**
 * Öffnet den Dashboard-WebSocket und schreibt Live-Status direkt in den
 * Query-Cache (kein Refetch nötig). Reconnect mit Backoff bei Verbindungsverlust.
 */
export function useDashboardSocket(): ConnState {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConnState>("connecting");

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let attempt = 0;
    let closedByUs = false;

    const connect = () => {
      setState("connecting");
      const proto = location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${proto}://${location.host}/ws`);

      socket.onopen = () => {
        attempt = 0;
        setState("open");
        socket?.send(JSON.stringify({ type: "subscribe", topic: "dashboard" }));
      };

      socket.onmessage = (event) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data as string) as ServerMessage;
        } catch {
          return;
        }
        if (msg.type === "server.status_changed") {
          queryClient.setQueryData<ServerDto[]>(serversQueryKey, (prev) =>
            prev?.map((s) =>
              s.id === msg.serverId ? { ...s, status: msg.status } : s,
            ),
          );
        }
      };

      socket.onclose = () => {
        setState("closed");
        if (closedByUs) return;
        attempt += 1;
        const delay = Math.min(1000 * 2 ** attempt, 15_000);
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closedByUs = true;
      clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [queryClient]);

  return state;
}
