import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    screens: {
      xs: "480px",
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "Fira Code", "ui-monospace", "monospace"],
      },
      // Deliberately no `colors` here. Theming is done entirely with CSS custom
      // properties in globals.css (--bg, --card, --brand, --accent-*, …) so the
      // five themes can swap at runtime. This file used to carry a second,
      // static, dark-only copy of that palette — `surface.card`,
      // `accent.cyan` and friends — which no component ever used and which
      // would silently break the four non-default themes if anyone did. The
      // animation/keyframes entries were likewise duplicates of the @keyframes
      // already in globals.css (which is what the inline `animation:` styles
      // actually resolve against), and `rounded-2xl` was never used anywhere.
    },
  },
  plugins: [],
};

export default config;
