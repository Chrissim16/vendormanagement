import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", ".data", "db/migrations", "docs", "playwright-report", "test-results", "*.config.js"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["client/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" },
  },
  {
    // Ports keep company-specific services swappable: only server/platform may touch an implementation.
    files: ["server/features/**/*.ts", "server/ai/**/*.ts", "client/**/*.{ts,tsx}", "shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@databricks/*",
                "pg",
                "@electric-sql/*",
                "**/ports/ai",
                "**/ports/jira",
                "**/ports/storage",
                "**/ports/database",
                "**/ports/identity",
                "**/ports/databricks",
              ],
              message: "Use the port interface from server/platform/ports/types instead.",
            },
          ],
        },
      ],
    },
  },
  { rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }] } },
);
