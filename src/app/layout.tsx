import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-osa-display" });
const sans = Inter({ subsets: ["latin"], variable: "--font-osa-sans" });

export const metadata: Metadata = {
  title: "OsaDrop · Envoie un fichier, directement",
  description: "Transfert de fichiers pair-à-pair, sans compte et sans serveur. Par OsaLabs.",
};
export const viewport: Viewport = { themeColor: "#0a0a0c" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={`${display.variable} ${sans.variable}`}>
      <body className="antialiased bg-[#0a0a0c] text-white">{children}</body>
    </html>
  );
}
