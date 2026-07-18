import { Socket } from "node:net";

/**
 * Minecraft Server List Ping (Protokoll 1.7+, JSON-Status).
 * Reine TCP-Implementierung ohne Fremdbibliothek — siehe
 * https://wiki.vg/Server_List_Ping
 */

export interface PingResult {
  version: { name: string; protocol: number };
  players: {
    max: number;
    online: number;
    sample?: { name: string; id: string }[];
  };
  description: unknown; // string oder Chat-Komponente
  latencyMs: number;
}

// ---- VarInt-Kodierung ----

function writeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  let v = value >>> 0;
  do {
    let temp = v & 0b0111_1111;
    v >>>= 7;
    if (v !== 0) temp |= 0b1000_0000;
    bytes.push(temp);
  } while (v !== 0);
  return Buffer.from(bytes);
}

/** Liest einen VarInt aus einem Buffer ab `offset`. */
function readVarInt(buffer: Buffer, offset: number): { value: number; size: number } {
  let value = 0;
  let size = 0;
  let byte: number;
  do {
    if (offset + size >= buffer.length) {
      throw new Error("VarInt unvollständig");
    }
    byte = buffer[offset + size]!;
    value |= (byte & 0b0111_1111) << (7 * size);
    size++;
    if (size > 5) throw new Error("VarInt zu lang");
  } while ((byte & 0b1000_0000) !== 0);
  return { value, size };
}

function writeString(str: string): Buffer {
  const strBuf = Buffer.from(str, "utf8");
  return Buffer.concat([writeVarInt(strBuf.length), strBuf]);
}

/** Rahmt einen Paket-Inhalt (Payload) mit vorangestellter Längenangabe. */
function framePacket(payload: Buffer): Buffer {
  return Buffer.concat([writeVarInt(payload.length), payload]);
}

/**
 * Fragt den Status eines Minecraft-Servers ab (Ping).
 * @throws bei Timeout oder Verbindungsfehler.
 */
export function pingServer(
  host: string,
  port: number,
  timeoutMs = 5000,
): Promise<PingResult> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const started = Date.now();
    let response = Buffer.alloc(0);
    let expectedLength = -1;
    let headerSize = 0;
    let settled = false;

    const finish = (err: Error | null, result?: PingResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(result!);
    };

    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => finish(new Error("Zeitüberschreitung beim Ping")));
    socket.on("error", (err) => finish(err));

    socket.connect(port, host, () => {
      // Handshake: protocol = -1 (Status-Ping), nextState = 1 (Status)
      const handshake = framePacket(
        Buffer.concat([
          writeVarInt(0x00), // Packet ID
          writeVarInt(0xffffffff), // Protokollversion -1 als VarInt
          writeString(host),
          (() => {
            const b = Buffer.alloc(2);
            b.writeUInt16BE(port, 0);
            return b;
          })(),
          writeVarInt(1),
        ]),
      );
      // Status Request (leeres Paket mit ID 0x00)
      const statusRequest = framePacket(writeVarInt(0x00));
      socket.write(Buffer.concat([handshake, statusRequest]));
    });

    socket.on("data", (chunk) => {
      response = Buffer.concat([response, chunk]);

      // Auf vollständigen Paket-Header (Länge) warten
      if (expectedLength < 0) {
        try {
          const { value, size } = readVarInt(response, 0);
          expectedLength = value;
          headerSize = size;
        } catch {
          return; // Header noch unvollständig
        }
      }

      if (response.length < headerSize + expectedLength) return; // mehr Daten nötig

      try {
        let cursor = headerSize;
        const packetId = readVarInt(response, cursor);
        cursor += packetId.size;
        if (packetId.value !== 0x00) {
          throw new Error(`Unerwartete Paket-ID: ${packetId.value}`);
        }
        const jsonLen = readVarInt(response, cursor);
        cursor += jsonLen.size;
        const json = response
          .subarray(cursor, cursor + jsonLen.value)
          .toString("utf8");
        const parsed = JSON.parse(json) as Omit<PingResult, "latencyMs">;
        finish(null, { ...parsed, latencyMs: Date.now() - started });
      } catch (err) {
        finish(err as Error);
      }
    });
  });
}
