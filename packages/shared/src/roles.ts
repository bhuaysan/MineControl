/** Benutzerrollen mit aufsteigenden Rechten. */
export const ROLES = ["VIEWER", "MODERATOR", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

/** Numerische Rangfolge für Rechte-Vergleiche (höher = mehr Rechte). */
export const ROLE_RANK: Record<Role, number> = {
  VIEWER: 0,
  MODERATOR: 1,
  ADMIN: 2,
};

/** Prüft, ob `role` mindestens den Rang von `required` hat. */
export function hasRole(role: Role, required: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}
