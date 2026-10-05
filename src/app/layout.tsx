import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OsaDrop | Transfert P2P",
  description: "Transfert de fichiers ultra-rapide en peer-to-peer sans serveur intermédiaire.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className="antialiased bg-[#050505] text-white">
        {children}
      </body>
    </html>
  );
}
