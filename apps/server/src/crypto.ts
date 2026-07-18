import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { config } from "./config.js";

/**
 * Symmetrische Verschlüsselung für Secrets, die im Klartext gebraucht werden
 * (RCON-Passwörter). AES-256-GCM mit zufälliger IV; Format: iv:tag:ciphertext
 * (jeweils base64), damit Rotation/Entschlüsselung eindeutig bleibt.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, config.encryptionKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Ungültiges Secret-Format");
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    config.encryptionKey,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
