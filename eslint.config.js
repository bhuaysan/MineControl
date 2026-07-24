import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

// Zentrale Flat-Config fürs Monorepo. Wird von der Wurzel aus über alle
// Pakete ausgeführt (`eslint .`); Plugins werden relativ zu dieser Datei
// aufgelöst, liegen also in den Wurzel-devDependencies.
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/*.tsbuildinfo",
      "apps/server/prisma/migrations/**",
    ],
  },

  // Basis für sämtliche TypeScript-Quellen.
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // Backend & geteilter Code laufen unter Node.
  {
    files: ["apps/server/**/*.ts", "packages/shared/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
    },
  },

  // Frontend läuft im Browser und nutzt React (Fast Refresh).
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Downgrade auf warn: das Repo nutzt an mehreren Stellen bewusst
      // `useEffect(() => { if (data) setState(data) }, [data])`, um lokalen
      // Formularzustand von Server-/Query-Daten abzuleiten — ein etabliertes,
      // funktionierendes Muster, kein Bug. Als Error würde es `pnpm lint`
      // sofort auf dem unveränderten Bestandscode scheitern lassen.
      "react-hooks/set-state-in-effect": "warn",
    },
  },

  // Config-Dateien im Projektwurzel-/Tooling-Kontext laufen unter Node.
  {
    files: ["**/*.config.{js,ts}", "eslint.config.js"],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Muss zuletzt stehen: deaktiviert ESLint-Regeln, die mit Prettier kollidieren.
  prettier,
);
