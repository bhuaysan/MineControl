/**
 * Einfacher In-Memory-Lockout gegen Brute-Force auf Login-Passwort und
 * 2FA-Codes. Kein externer Store nötig (Single-Process-Server, wie auch
 * `resourceLocks` in networks/service.ts) — nach einem Neustart ist der
 * Zähler leer, was für dieses Bedrohungsmodell (Online-Rateraten) ok ist.
 */
interface Bucket {
  count: number;
  firstAttemptAt: number;
  blockedUntil?: number;
}

const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;
const BLOCK_MS = 15 * 60_000;

const buckets = new Map<string, Bucket>();

/** `true`, wenn `key` aktuell wegen zu vieler Fehlversuche gesperrt ist. */
export function isRateLimited(key: string): boolean {
  const bucket = buckets.get(key);
  return Boolean(bucket?.blockedUntil && bucket.blockedUntil > Date.now());
}

/** Registriert einen Fehlversuch; sperrt `key` nach `MAX_ATTEMPTS` je `WINDOW_MS`. */
export function registerFailedAttempt(key: string): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.firstAttemptAt > WINDOW_MS) {
    buckets.set(key, { count: 1, firstAttemptAt: now });
    return;
  }
  bucket.count += 1;
  if (bucket.count >= MAX_ATTEMPTS) {
    bucket.blockedUntil = now + BLOCK_MS;
  }
}

/** Setzt den Zähler nach einem erfolgreichen Versuch zurück. */
export function clearAttempts(key: string): void {
  buckets.delete(key);
}

// Verhindert unbegrenztes Wachstum der Map bei vielen verschiedenen
// Usernamen/IPs (verteilter Angriff) — abgelaufene, nicht gesperrte Buckets
// regelmäßig entfernen.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    const expired = now - bucket.firstAttemptAt > WINDOW_MS;
    const stillBlocked = bucket.blockedUntil && bucket.blockedUntil > now;
    if (expired && !stillBlocked) buckets.delete(key);
  }
}, WINDOW_MS).unref();
