import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

/** Unterstützte Sprachen. `de` ist die Ausgangssprache und der Fallback. */
export const SUPPORTED_LANGUAGES = ["de", "en"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<Language, string> = {
  de: "Deutsch",
  en: "English",
};

/**
 * Übersetzungen liegen als eine JSON-Datei pro Namespace und Sprache unter
 * `./locales/<lng>/<namespace>.json`. Statt jede Datei einzeln zu importieren
 * (und diese Config bei jedem neuen Namespace anzufassen), sammelt Vites
 * `import.meta.glob` sie beim Build automatisch ein. Ein neuer Namespace ist
 * damit nur eine neue JSON-Datei — kein Eingriff hier.
 */
const modules = import.meta.glob<{ default: Record<string, unknown> }>("./locales/*/*.json", {
  eager: true,
});

type Resources = Record<string, Record<string, Record<string, unknown>>>;

const resources: Resources = {};
const namespaceSet = new Set<string>();

for (const [path, mod] of Object.entries(modules)) {
  // Pfadform: ./locales/de/common.json → ["de", "common"]
  const match = /\.\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
  if (!match) continue;
  const lng = match[1]!;
  const ns = match[2]!;
  namespaceSet.add(ns);
  resources[lng] ??= {};
  resources[lng][ns] = mod.default;
}

export const namespaces = [...namespaceSet];

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    ns: namespaces,
    defaultNS: "common",
    fallbackLng: "de",
    supportedLngs: SUPPORTED_LANGUAGES,
    // Nur die Basissprache berücksichtigen (de-DE, de-AT → de).
    load: "languageOnly",
    nonExplicitSupportedLngs: true,
    interpolation: {
      // React escaped bereits selbst.
      escapeValue: false,
    },
    detection: {
      // Erst die gespeicherte Wahl, dann die Browsersprache.
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "mc.language",
      caches: ["localStorage"],
    },
  });

export default i18n;
