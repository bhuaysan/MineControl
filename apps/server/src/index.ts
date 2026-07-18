import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { authRoutes } from "./modules/auth/routes.js";
import { auditRoutes } from "./modules/audit/routes.js";
import { serverRoutes } from "./modules/servers/routes.js";
import { userRoutes } from "./modules/users/routes.js";
import { registerWebsocket } from "./ws/index.js";

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

  app.get("/api/health", async () => ({ status: "ok" }));

  await app.register(authRoutes);
  await app.register(serverRoutes);
  await app.register(userRoutes);
  await app.register(auditRoutes);
  await registerWebsocket(app);

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
