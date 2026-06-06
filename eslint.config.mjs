import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

// Flat-config replacement for the old `.eslintrc.json` + `next lint`.
// `next lint` is removed in Next 16, so we drive ESLint directly via the CLI.
// eslint-config-next 16 exports a native flat-config array — spread it directly
// instead of bridging the legacy preset through FlatCompat. Behaviour mirrors
// the previous setup: the single `next/core-web-vitals` ruleset, nothing added.
// (Held at ESLint 9: ESLint 10 crashes the bundled eslint-plugin-react /
// typescript-eslint versions — revisit when those gain ESLint 10 support.)
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
  ...nextCoreWebVitals,
  {
    // Pin the React version so eslint-plugin-react skips its filesystem-based
    // auto-detection ("detect" resolves to the same 19.2.x anyway). Also
    // forward-proofs the ESLint 10 move, where the detection path calls the
    // removed `context.getFilename()` and crashes.
    settings: { react: { version: "19.2" } },
    // eslint-config-next 16 ships eslint-plugin-react-hooks 7 (the React
    // Compiler ruleset), which adds three rules that were absent under
    // config-next 15. They flag ~22 long-standing, intentional patterns
    // (polling effects, hydration `setMounted` guards, `Date.now()` reads).
    // Keep them visible as warnings — same treatment as the existing <img>
    // warnings — and address them in a dedicated React-Compiler pass rather
    // than letting a dependency bump force 12 files of behavioural refactors.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
    },
  },
];

export default eslintConfig;
