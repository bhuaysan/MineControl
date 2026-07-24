import { useTranslation } from "react-i18next";
import { LANGUAGE_NAMES, SUPPORTED_LANGUAGES, type Language } from "../i18n/index.js";

/**
 * Sprachauswahl. Die Wahl wird von i18next automatisch in localStorage
 * (`mc.language`) gespeichert und beim nächsten Start wieder aufgegriffen.
 */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current = (
    SUPPORTED_LANGUAGES.includes(i18n.resolvedLanguage as Language) ? i18n.resolvedLanguage : "de"
  ) as Language;

  return (
    <label className="flex items-center gap-2 px-1 text-neutral-400">
      <span className="text-xs">🌐</span>
      <span className="sr-only">{t("nav:language")}</span>
      <select
        value={current}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
        aria-label={t("nav:language")}
        className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm outline-none focus:border-status-online"
      >
        {SUPPORTED_LANGUAGES.map((lng) => (
          <option key={lng} value={lng}>
            {LANGUAGE_NAMES[lng]}
          </option>
        ))}
      </select>
    </label>
  );
}
