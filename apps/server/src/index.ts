import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { authRoutes } from "./modules/auth/routes.js";
import { auditRoutes } from "./modules/audit/routes.js";
import { backupRoutes } from "./modules/backups/routes.js";
import { fileRoutes } from "./modules/files/routes.js";
import { luckPermsRoutes } from "./modules/luckperms/routes.js";
import { metricRoutes } from "./modules/metrics/routes.js";
import { startMetricSampler } from "./modules/metrics/service.js";
import { modRoutes } from "./modules/mods/routes.js";
import { networkRoutes } from "./modules/networks/routes.js";
import { notificationRoutes } from "./modules/notifications/routes.js";
import { playerRoutes } from "./modules/players/routes.js";
import { serverRoutes } from "./modules/servers/routes.js";
import { ensureSeedAdmin } from "./seed.js";
import { taskRoutes } from "./modules/tasks/routes.js";
import { startScheduler } from "./modules/tasks/service.js";
import { tokenRoutes } from "./modules/tokens/routes.js";
import { twoFactorRoutes } from "./modules/twofa/routes.js";
import { userRoutes } from "./modules/users/routes.js";
import { worldRoutes } from "./modules/world/routes.js";
import { registerWebsocket } from "./ws/index.js";

async function main(): Promise<void> {
  const app = Fastify({
    logger: {
      level: config.isProduction ? "info" : "debug",
      transport: config.isProduction
        ? undefined
        : { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } },
    },
    // Läuft produktiv hinter Caddy (deploy/Caddyfile) als einzigem Reverse-Proxy
    // — request.ip muss den echten Client aus X-Forwarded-For lesen, sonst
    // träfe IP-basiertes Rate-Limiting (Login/2FA) alle Nutzer als eine Quelle.
    trustProxy: true,
  });

  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(cors, { origin: config.webOrigin, credentials: true });
  await app.register(websocket);
  // Datei-Uploads (Datei-Manager) — Obergrenze 50 MB je Datei.
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  app.get("/api/health", async () => ({ status: "ok" }));

  await app.register(authRoutes);
  await app.register(serverRoutes);
  await app.register(userRoutes);
  await app.register(auditRoutes);
  await app.register(backupRoutes);
  await app.register(fileRoutes);
  await app.register(luckPermsRoutes);
  await app.register(taskRoutes);
  await app.register(metricRoutes);
  await app.register(modRoutes);
  await app.register(networkRoutes);
  await app.register(notificationRoutes);
  await app.register(playerRoutes);
  await app.register(tokenRoutes);
  await app.register(twoFactorRoutes);
  await app.register(worldRoutes);
  await registerWebsocket(app);

  // Erststart-Admin anlegen, falls noch kein Benutzer existiert (idempotent).
  await ensureSeedAdmin();

  // Hintergrunddienste: geplante Tasks (cron) + periodische Metrik-Erfassung.
  await startScheduler();
  startMetricSampler();

  // Kontrollierter Shutdown statt Weiterlaufen in undefiniertem Zustand: eine
  // uncaughtException/unhandledRejection kann den Prozess (Docker-Steuerung,
  // offene RCON-/Log-Streams) teilmutiert zurücklassen — sicherer ist, den
  // Prozess sauber zu beenden und den Supervisor (docker-compose
  // `restart: unless-stopped`, siehe deploy/docker-compose.yml) neu starten
  // zu lassen, als mit unbekanntem Zustand weiterzumachen.
  let shuttingDown = false;
  const shutdown = async (reason: string, exitCode: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.error(`${reason} — fahre kontrolliert herunter (Exit ${exitCode})`);
    // Falls das Herunterfahren selbst hängt (z. B. ein Docker-Log-Stream, der
    // nicht sauber schließt) — nach kurzer Frist trotzdem hart beenden.
    const forceExit = setTimeout(() => process.exit(exitCode), 10_000);
    forceExit.unref();
    try {
      await app.close();
      await prisma.$disconnect();
    } catch (err) {
      console.error("Fehler beim Herunterfahren:", err);
    } finally {
      clearTimeout(forceExit);
      process.exit(exitCode);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT", 0));
  process.on("SIGTERM", () => void shutdown("SIGTERM", 0));
  process.on("uncaughtException", (err) => {
    console.error("Unbehandelte Ausnahme:", err);
    void shutdown("uncaughtException", 1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("Unbehandelte Promise-Ablehnung:", reason);
    void shutdown("unhandledRejection", 1);
  });

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  console.error("Serverstart fehlgeschlagen:", err);
  process.exit(1);
});
