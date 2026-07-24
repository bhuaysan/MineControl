import { docker } from "./adapters/dockerClient.js";
import { prisma } from "./db.js";

/** Ergebnis einer einzelnen Abhängigkeitsprüfung. */
interface DependencyCheck {
  ok: boolean;
  /** Kurze, secret-freie Fehlerkennung (nur bei ok=false). */
  error?: string;
}

export interface ReadinessReport {
  status: "ready" | "degraded";
  checks: {
    database: DependencyCheck;
    docker: DependencyCheck;
  };
}

/** Kurzes Oberlimit je Readiness-Prüfung — ein hängender Daemon/DB-Socket darf
 * den Health-Endpoint nicht selbst zum Hänger machen. */
const CHECK_TIMEOUT_MS = 3000;

function withTimeout<T>(op: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} nach ${CHECK_TIMEOUT_MS} ms ohne Antwort`)),
      CHECK_TIMEOUT_MS,
    );
    op.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e as Error);
      },
    );
  });
}

/**
 * Bewusst secret-frei: Für den externen Report wird nur eine grobe Kennung
 * gemeldet, nie die rohe Fehlermeldung (die z. B. einen DB-Connection-String
 * oder Socket-Pfad enthalten könnte). Der volle Fehler wird beim Aufruf geloggt.
 */
async function check(label: string, op: () => Promise<unknown>): Promise<DependencyCheck> {
  try {
    await withTimeout(op(), label);
    return { ok: true };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}

/**
 * Prüft die kritischen Abhängigkeiten (DB, Docker-Daemon). „degraded", sobald
 * eine davon nicht erreichbar ist — der Aufrufer (Route) übersetzt das in HTTP
 * 503, damit ein Monitoring/Compose-Healthcheck echte Arbeitsfähigkeit sieht
 * statt nur „Prozess lebt".
 */
export async function checkReadiness(): Promise<ReadinessReport> {
  const [database, dockerCheck] = await Promise.all([
    check("DB-Ping", () => prisma.$queryRaw`SELECT 1`),
    check("Docker-Ping", () => docker.ping()),
  ]);
  const status = database.ok && dockerCheck.ok ? "ready" : "degraded";
  return { status, checks: { database, docker: dockerCheck } };
}
