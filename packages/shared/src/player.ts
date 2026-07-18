/** Globaler Spieler-Datensatz (server-übergreifend). */
export interface PlayerProfile {
  uuid: string;
  lastKnownName: string;
  firstSeen: string;
  lastSeen: string;
  notes?: string;
}
