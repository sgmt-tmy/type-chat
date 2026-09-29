import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "type-chat",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
