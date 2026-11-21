import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Bundled, not next/font/google: that downloads the fonts from Google during
// every build, and a failed download failed CI's image build three times.
// Both are the variable-weight Latin files from Fontsource (SIL OFL 1.1,
// licences beside them), so one file covers every weight.
const inter = localFont({
  src: "./fonts/inter-latin-wght.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-inter",
});

const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono-latin-wght.woff2",
  weight: "100 800",
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "ComExe",
  description: "ComExe — homelab metrics dashboard",
};

// Next.js 15 requires viewport to be its own export, not a metadata field.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

// Inline script that applies the saved theme class before React hydrates,
// preventing a flash of the default Midnight Cyan theme. Also auto-detects
// prefers-color-scheme for first-time visitors who haven't chosen a theme.
const themeScript = `
(function(){
  try {
    var s = localStorage.getItem("comexe:settings");
    if (s) {
      var t = JSON.parse(s).theme;
      // Paper is the only non-default theme; retired ones fall back to Midnight.
      if (t === "paper") document.documentElement.classList.add("theme-paper");
    } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
      document.documentElement.classList.add("theme-paper");
    }
  } catch(e){}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
