import { useState } from "react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation("playerAvatar");
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
      alt={t("alt", { name })}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className="shrink-0 rounded"
      style={{ imageRendering: "pixelated" }}
    />
  );
}
