/**
 * Wandelt die `description` eines Ping-Ergebnisses in reinen Text um.
 * Kann ein String oder eine (verschachtelte) Chat-Komponente sein.
 */
export function motdToText(description: unknown): string {
  if (typeof description === "string") return description;
  if (!description || typeof description !== "object") return "";

  const node = description as {
    text?: string;
    extra?: unknown[];
  };
  let text = node.text ?? "";
  if (Array.isArray(node.extra)) {
    for (const child of node.extra) {
      text += motdToText(child);
    }
  }
  return text;
}
