import argon2 from "argon2";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { logger } from "./logger.js";

/**
 * Legt beim ersten Start einen Admin-Benutzer an — aber nur, wenn noch gar
 * kein Benutzer existiert. Idempotent: läuft bei jedem Start, tut aber nichts,
 * sobald mindestens ein User da ist. Zugangsdaten aus SEED_ADMIN_USER/PASSWORD.
 *
 * Wird beim Backend-Start aufgerufen, damit ein frisch bereitgestellter
 * Container (Docker-Deployment) sofort einen Login besitzt — ohne den
 * separaten `prisma db seed`-Schritt.
 */
export async function ensureSeedAdmin(): Promise<void> {
  const count = await prisma.user.count();
  if (count > 0) return;

  const { username, password } = config.seedAdmin;
  if (!password) {
    logger.warn(
      "Kein Benutzer vorhanden und SEED_ADMIN_PASSWORD nicht gesetzt — es wurde kein Admin angelegt.",
    );
    return;
  }

  const passwordHash = await argon2.hash(password);
  await prisma.user.create({
    data: { username, passwordHash, role: "ADMIN" },
  });
  logger.info({ username }, "Admin-Benutzer angelegt (erster Start)");
}
