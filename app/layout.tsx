import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paper PDF Renamer",
  description: "Extract DOI from PDF and rename file with Crossref metadata",
};

export const metadata = {
  icons: {
    icon: "/favicon.ico",
  },
};


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
