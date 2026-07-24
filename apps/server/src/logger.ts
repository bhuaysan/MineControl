import { pino, type LoggerOptions } from "pino";
import { config } from "./config.js";

/**
 * Gemeinsame pino-Konfiguration. Wird von Fastify (index.ts: `logger:
 * loggerOptions`) UND von der eigenständigen {@link logger}-Instanz genutzt,
 * damit Request-Logs und Betriebs-Logs im selben Format und Level ausgegeben
 * werden. (Bewusst eine geteilte Konfig statt einer via `loggerInstance`
 * geteilten Instanz: Letzteres verengt Fastifys Logger-Typparameter und bricht
 * die Kompatibilität mit den Plugin-Signaturen.)
 *
 * In der Entwicklung menschenlesbar (pino-pretty), produktiv reines JSON auf
 * stdout — damit ein Log-Sammler die Felder strukturiert weiterverarbeiten kann.
 */
export const loggerOptions: LoggerOptions = {
  level: config.isProduction ? "info" : "debug",
  transport: config.isProduction
    ? undefined
    : { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } },
};

/**
 * Eigenständige pino-Instanz für alles außerhalb der Fastify-Request-Kette
 * (Metrik-Sampler, Scheduler, WS-Streams, Docker-Adapter, Prozess-Handler).
 *
 * Zuvor loggten diese Module über `console.*` — unstrukturiert, ohne Kontext-
 * felder und am pino-Log vorbei. Über diesen Export bekommen sie strukturierte
 * Log-Zeilen (`logger.error({ err, serverId }, "…")`) im selben Format wie die
 * Fastify-Request-Logs.
 */
export const logger = pino(loggerOptions);
