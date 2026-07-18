import type {
  PlayerHistoryEntryDto,
  PlayerListItemDto,
  PlayerProfileDto,
  PlayerSessionDto,
} from "@minecontrol/shared";
import { prisma } from "../../db.js";

/** Gültiger Minecraft-Name (Session-Tracking ignoriert alles andere). */
const NAME_RE = /^[A-Za-z0-9_]{1,16}$/;

/** Audit-Aktionen, die im Spieler-Verlauf auftauchen. */
const HISTORY_ACTIONS = [
  "player.kick",
  "player.ban",
  "player.unban",
  "player.op",
  "player.deop",
  "player.whitelist_add",
  "player.whitelist_remove",
];

function sessionSeconds(joinedAt: Date, leftAt: Date | null, now: Date): number {
  return Math.max(0, Math.floor(((leftAt ?? now).getTime() - joinedAt.getTime()) / 1000));
}

/** Legt einen Spieler an oder aktualisiert lastSeen/Namen. */
async function upsertPlayer(name: string, now: Date): Promise<void> {
  await prisma.player.upsert({
    where: { uuid: name },
    create: { uuid: name, lastKnownName: name, firstSeen: now, lastSeen: now },
    update: { lastSeen: now, lastKnownName: name },
  });
}

/**
 * Gleicht die aktuell online gemeldeten Spieler eines Servers mit den offenen
 * Sessions in der DB ab: neue Namen → Session öffnen, verschwundene → schließen.
 * DB-gestützt (kein In-Memory-Zustand), daher neustart-fest. Wird pro Sampler-
 * Tick aufgerufen; ein leeres `onlineNames` schließt alle offenen Sessions.
 */
export async function reconcileSessions(
  serverId: string,
  onlineNames: string[],
): Promise<void> {
  const now = new Date();
  const online = new Set(onlineNames.filter((n) => NAME_RE.test(n)));

  const openSessions = await prisma.playerSession.findMany({
    where: { serverId, leftAt: null },
  });
  const openNames = new Set(openSessions.map((s) => s.playerId));

  // Beigetreten: online, aber keine offene Session.
  for (const name of online) {
    if (openNames.has(name)) {
      await upsertPlayer(name, now); // weiter online → lastSeen aktualisieren
    } else {
      await upsertPlayer(name, now);
      await prisma.playerSession.create({
        data: { playerId: name, serverId, joinedAt: now },
      });
    }
  }

  // Verlassen: offene Session, aber nicht mehr online.
  for (const session of openSessions) {
    if (!online.has(session.playerId)) {
      await prisma.playerSession.update({
        where: { id: session.id },
        data: { leftAt: now },
      });
      await upsertPlayer(session.playerId, now);
    }
  }
}

/** Alle bekannten Spieler mit Gesamt-Spielzeit und Online-Status. */
export async function listPlayers(): Promise<PlayerListItemDto[]> {
  const now = new Date();
  const players = await prisma.player.findMany({
    include: { sessions: true },
    orderBy: { lastSeen: "desc" },
  });
  return players.map((p) => ({
    key: p.uuid,
    name: p.lastKnownName,
    lastSeen: p.lastSeen.toISOString(),
    totalPlaytimeSeconds: p.sessions.reduce(
      (sum, s) => sum + sessionSeconds(s.joinedAt, s.leftAt, now),
      0,
    ),
    online: p.sessions.some((s) => s.leftAt === null),
  }));
}

/** Vollständiges Profil eines Spielers oder `null`, wenn unbekannt. */
export async function getPlayerProfile(key: string): Promise<PlayerProfileDto | null> {
  const now = new Date();
  const player = await prisma.player.findUnique({
    where: { uuid: key },
    include: {
      sessions: { orderBy: { joinedAt: "desc" }, include: { server: true } },
    },
  });
  if (!player) return null;

  const recentSessions: PlayerSessionDto[] = player.sessions.slice(0, 20).map((s) => ({
    serverId: s.serverId,
    serverName: s.server?.name,
    joinedAt: s.joinedAt.toISOString(),
    leftAt: s.leftAt?.toISOString(),
    seconds: sessionSeconds(s.joinedAt, s.leftAt, now),
  }));
  const openSession = player.sessions.find((s) => s.leftAt === null);

  // Verlauf aus dem Audit-Log (details.player == Name).
  const logs = await prisma.auditLog.findMany({
    where: { action: { in: HISTORY_ACTIONS } },
    orderBy: { timestamp: "desc" },
    take: 300,
    include: { server: true },
  });
  const history: PlayerHistoryEntryDto[] = [];
  for (const log of logs) {
    if (!log.details) continue;
    let details: { player?: string; reason?: string };
    try {
      details = JSON.parse(log.details) as { player?: string; reason?: string };
    } catch {
      continue;
    }
    if (details.player !== player.lastKnownName) continue;
    history.push({
      action: log.action,
      serverName: log.server?.name,
      timestamp: log.timestamp.toISOString(),
      reason: details.reason,
    });
    if (history.length >= 50) break;
  }

  return {
    key: player.uuid,
    name: player.lastKnownName,
    firstSeen: player.firstSeen.toISOString(),
    lastSeen: player.lastSeen.toISOString(),
    notes: player.notes ?? undefined,
    totalPlaytimeSeconds: player.sessions.reduce(
      (sum, s) => sum + sessionSeconds(s.joinedAt, s.leftAt, now),
      0,
    ),
    sessionCount: player.sessions.length,
    online: Boolean(openSession),
    currentServerId: openSession?.serverId,
    recentSessions,
    history,
  };
}

/** Setzt die Admin-Notiz eines Spielers. */
export async function updatePlayerNotes(
  key: string,
  notes: string,
): Promise<boolean> {
  const exists = await prisma.player.count({ where: { uuid: key } });
  if (exists === 0) return false;
  await prisma.player.update({
    where: { uuid: key },
    data: { notes: notes.trim() || null },
  });
  return true;
}
