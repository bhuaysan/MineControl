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
import { taskRoutes } from "./modules/tasks/routes.js";
import { startScheduler } from "./modules/tasks/service.js";
import { tokenRoutes } from "./modules/tokens/routes.js";
import { twoFactorRoutes } from "./modules/twofa/routes.js";
import { userRoutes } from "./modules/users/routes.js";
import { worldRoutes } from "./modules/world/routes.js";
import { registerWebsocket } from "./ws/index.js";

// Sicherheitsnetz: Das Backend steuert Docker & RCON — ein einzelner
// asynchroner Fehler (z. B. ein Socket-`error`-Event einer flatterhaften
// RCON-Verbindung zu einem bootenden Server) darf den ganzen Prozess nicht
// abstürzen lassen. Solche Fehler werden protokolliert statt fatal behandelt.
process.on("uncaughtException", (err) => {
  console.error("Unbehandelte Ausnahme (Prozess bleibt am Leben):", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unbehandelte Promise-Ablehnung:", reason);
});

async function main(): Promise<void> {
  const app = Fastify({
    logger: {
      level: config.isProduction ? "info" : "debug",
      transport: config.isProduction
        ? undefined
        : { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } },
    },
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

  // Hintergrunddienste: geplante Tasks (cron) + periodische Metrik-Erfassung.
  await startScheduler();
  startMetricSampler();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} empfangen — fahre herunter`);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  console.error("Serverstart fehlgeschlagen:", err);
  process.exit(1);
});
