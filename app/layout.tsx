import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ComExe · live",
  description: "ComExe — homelab metrics dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
