import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "type-chat",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>
        <AppHeader />
        <main className="mx-auto max-w-2xl px-4">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
