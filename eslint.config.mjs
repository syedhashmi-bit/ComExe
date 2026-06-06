import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

// Flat-config replacement for the old `.eslintrc.json` + `next lint`.
// `next lint` is removed in Next 16 and incompatible with ESLint 10, so we drive
// ESLint directly via the CLI. FlatCompat bridges eslint-config-next's classic
// "extends" preset into the flat format. Behaviour mirrors the previous setup:
// the single `next/core-web-vitals` ruleset, nothing added.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "node_modules/**",
      "coverage/**",
      "storybook-static/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals"),
];

export default eslintConfig;
