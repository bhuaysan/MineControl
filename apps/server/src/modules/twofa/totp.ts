import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP nach RFC 6238 (SHA-1, 30 s Schritt, 6 Stellen) — kompatibel mit gängigen
 * Authenticator-Apps. Handgeschrieben, um keine Abhängigkeit einzuführen.
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32.indexOf(char);
    if (idx === -1) throw new Error("Ungültiges Base32-Zeichen");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Erzeugt ein neues, zufälliges Base32-Secret (20 Byte Entropie). */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** HOTP-Wert für einen bestimmten Zähler. */
function hotp(secretB32: string, counter: number): string {
  const key = base32Decode(secretB32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

/**
 * Prüft einen Code gegen das Secret (±`window` Schritte Toleranz) und liefert
 * bei Erfolg den akzeptierten Zeitschritt (Counter), sonst `null`. Der Counter
 * erlaubt dem Aufrufer, einen bereits verbrauchten Code abzulehnen (Replay).
 */
export function verifyToken(secretB32: string, token: string, window = 1): number | null {
  const cleaned = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleaned)) return null;
  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  for (let i = -window; i <= window; i++) {
    const expected = hotp(secretB32, counter + i);
    const a = Buffer.from(expected);
    const b = Buffer.from(cleaned);
    if (a.length === b.length && timingSafeEqual(a, b)) return counter + i;
  }
  return null;
}

/** otpauth://-URI für QR-Code / manuellen Import. */
export function otpauthUri(secretB32: string, account: string, issuer = "MineControl"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
