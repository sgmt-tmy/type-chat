import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { Toaster } from "@/components/ui/sonner";
import { getCurrentUserInPage } from "../server/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "type-chat",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUserInPage();
  return (
    <html lang="ja">
      <body>
        <AppHeader userName={user?.name ?? null} />
        <main className="mx-auto max-w-2xl px-4">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
