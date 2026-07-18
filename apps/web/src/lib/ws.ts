import type { ClientMessage, ServerMessage, WsTopic } from "@minecontrol/shared";

/**
 * Öffnet einen WebSocket, abonniert genau ein Thema und ruft `onMessage` je
 * eingehender Nachricht. Reconnect mit Backoff. Rückgabe: Aufräum-Funktion,
 * die sauber abbestellt und schließt.
 */
export function openTopicSocket(
  topic: WsTopic,
  onMessage: (msg: ServerMessage) => void,
  onState?: (open: boolean) => void,
): () => void {
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout>;
  let attempt = 0;
  let closedByUs = false;

  const connect = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${proto}://${location.host}/ws`);

    socket.onopen = () => {
      attempt = 0;
      onState?.(true);
      const sub: ClientMessage = { type: "subscribe", topic };
      socket?.send(JSON.stringify(sub));
    };

    socket.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data as string) as ServerMessage);
      } catch {
        /* ungültige Nachricht ignorieren */
      }
    };

    socket.onclose = () => {
      onState?.(false);
      if (closedByUs) return;
      attempt += 1;
      reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** attempt, 15_000));
    };
  };

  connect();

  return () => {
    closedByUs = true;
    clearTimeout(reconnectTimer);
    if (socket?.readyState === WebSocket.OPEN) {
      const unsub: ClientMessage = { type: "unsubscribe", topic };
      socket.send(JSON.stringify(unsub));
    }
    socket?.close();
  };
}
