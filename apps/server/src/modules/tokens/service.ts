import { createHash, randomBytes } from "node:crypto";
import type { ApiToken, Role } from "@prisma/client";
import type { ApiTokenDto } from "@minecontrol/shared";
import { prisma } from "../../db.js";

const PREFIX = "mc_";

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function toApiTokenDto(token: ApiToken): ApiTokenDto {
  return {
    id: token.id,
    name: token.name,
    role: token.role,
    prefix: token.prefix,
    createdAt: token.createdAt.toISOString(),
    lastUsedAt: token.lastUsedAt?.toISOString(),
    expiresAt: token.expiresAt?.toISOString(),
  };
}

/** Erzeugt ein Token, speichert nur dessen Hash und gibt es einmalig zurück. */
export async function createToken(
  userId: string,
  name: string,
  role: Role,
  expiresInDays?: number,
): Promise<{ token: string; dto: ApiTokenDto }> {
  const raw = PREFIX + randomBytes(24).toString("hex");
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 86_400_000)
    : null;
  const created = await prisma.apiToken.create({
    data: {
      name,
      tokenHash: hashToken(raw),
      prefix: raw.slice(0, PREFIX.length + 8),
      role,
      userId,
      expiresAt,
    },
  });
  return { token: raw, dto: toApiTokenDto(created) };
}

export async function listTokens(): Promise<ApiTokenDto[]> {
  const tokens = await prisma.apiToken.findMany({ orderBy: { createdAt: "desc" } });
  return tokens.map(toApiTokenDto);
}

export async function revokeToken(id: string): Promise<boolean> {
  const count = await prisma.apiToken.count({ where: { id } });
  if (count === 0) return false;
  await prisma.apiToken.delete({ where: { id } });
  return true;
}

/** Prüft ein Bearer-Token und liefert die zugehörige Identität (oder null). */
export async function verifyToken(
  raw: string,
): Promise<{ userId: string; username: string; role: Role } | null> {
  if (!raw.startsWith(PREFIX)) return null;
  const token = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: true },
  });
  if (!token) return null;
  if (token.expiresAt && token.expiresAt.getTime() < Date.now()) return null;

  // Best effort: letzte Nutzung protokollieren.
  prisma.apiToken
    .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return {
    userId: token.userId,
    username: `token:${token.name}`,
    role: token.role,
  };
}
