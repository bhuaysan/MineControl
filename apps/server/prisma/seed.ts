import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

/**
 * Legt beim ersten Start einen Admin-Benutzer an — aber nur, wenn noch
 * gar kein Benutzer existiert. Zugangsdaten aus SEED_ADMIN_USER/PASSWORD.
 */
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const count = await prisma.user.count();
  if (count > 0) {
    console.log(`Seed übersprungen — es existieren bereits ${count} Benutzer.`);
    return;
  }

  const username = process.env.SEED_ADMIN_USER ?? "admin";
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) {
    console.error("SEED_ADMIN_PASSWORD ist nicht gesetzt — kein Admin angelegt.");
    process.exitCode = 1;
    return;
  }

  const passwordHash = await argon2.hash(password);
  await prisma.user.create({
    data: { username, passwordHash, role: "ADMIN" },
  });
  console.log(`Admin-Benutzer „${username}" angelegt.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
