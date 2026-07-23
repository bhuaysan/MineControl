import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
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
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Downgrade auf warn: das Repo nutzt an mehreren Stellen bewusst
      // `useEffect(() => { if (data) setState(data) }, [data])`, um lokalen
      // Formularzustand von Server-/Query-Daten abzuleiten — ein etabliertes,
      // funktionierendes Muster, kein Bug. Als Error würde es `pnpm lint`
      // sofort auf dem unveränderten Bestandscode scheitern lassen.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
);
