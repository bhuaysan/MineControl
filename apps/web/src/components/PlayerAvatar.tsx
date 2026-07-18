import { useState } from "react";

interface Props {
  name: string;
  uuid?: string;
  size?: number;
}

/**
 * Zeigt den Skin-Kopf eines Spielers. mc-heads.net funktioniert mit Name
 * oder UUID; bei Ladefehler Fallback auf die Initiale.
 */
export function PlayerAvatar({ name, uuid, size = 24 }: Props) {
  const [failed, setFailed] = useState(false);
  const src = `https://mc-heads.net/avatar/${encodeURIComponent(uuid ?? name)}/${size}`;

  if (failed) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded bg-neutral-700 text-xs font-medium text-neutral-200"
        style={{ width: size, height: size }}
        aria-hidden
      >
        {name.charAt(0).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={`Kopf von ${name}`}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className="shrink-0 rounded"
      style={{ imageRendering: "pixelated" }}
    />
  );
}
